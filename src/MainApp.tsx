import { LucyOS } from './components/layout/LucyOS';
import { AuthGate } from './components/AuthGate';
import { useEffect, useState, useCallback, useRef } from 'react';
import { getCurrentWindow, cursorPosition } from '@tauri-apps/api/window';
import { useAvatarState } from './lib/store/avatarState';
import { userAuth } from './lib/auth/userAuth';
import { emitCrossWindow, listenCrossWindow } from './lib/events/crossWindowEventBus';
import { isTauriApp } from './lib/system/tauriBridge';

const safe = async (p: Promise<any>) => {
  try { await p; } catch (e) { console.warn('Tauri API error:', e); }
};

export default function MainApp() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [licenseStatus, setLicenseStatus] = useState<'checking' | 'locked' | 'authorized'>('checking');
  const [hasApiKey, setHasApiKey] = useState(() =>
    !!localStorage.getItem('lucy_main_api_key')
  );

  const windowReadyRef = useRef(false);

  // Early boot check to show the window if launched manually
  useEffect(() => {
    if (!isTauriApp()) return;
    const bootCheck = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const isAutostart = await invoke<boolean>('is_autostart');
        const win = getCurrentWindow();
        await safe(win.setIgnoreCursorEvents(true));
        
        if (!isAutostart) {
          await safe(win.setSkipTaskbar(false));
          await safe(win.show());
        } else {
          await safe(win.setSkipTaskbar(true));
        }
      } catch (e) {}
    };
    bootCheck();
  }, []);

  const setupMainWindow = useCallback(async (isAutostart = false) => {
    if (!isTauriApp()) {
      windowReadyRef.current = true;
      window.dispatchEvent(new CustomEvent('lucy-force-init'));
      return;
    }
    try {
      const win = getCurrentWindow();

      if (!isAutostart) {
        await safe(win.setAlwaysOnTop(true)); // Force restore alwaysOnTop
        await safe(win.maximize());
        await safe(win.show());
        await safe(win.setIgnoreCursorEvents(true)); // Force click-through mode on desktop
      }
      
      // Hide from taskbar now that authentication is complete. 
      // This MUST be called after maximize(), because Windows restores the taskbar icon when a window is maximized!
      await safe(win.setSkipTaskbar(true));
      
      windowReadyRef.current = true;
      window.dispatchEvent(new CustomEvent('lucy-force-init'));
    } catch (e) {
      console.warn('setupMainWindow failed', e);
    }
  }, []);

  useEffect(() => {
    if (licenseStatus === 'authorized') {
      const initWindow = async () => {
        let isAutostart = false;
        if (isTauriApp()) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            isAutostart = await invoke<boolean>('is_autostart');
          } catch(e) {}

          await setupMainWindow(isAutostart);

          try {
            const autostartPlugin = await import('@tauri-apps/plugin-autostart');
            const autostartEnabled = await autostartPlugin.isEnabled();
            if (!autostartEnabled) {
              await autostartPlugin.enable();
            }
          } catch (e) {
            console.warn('autostart check failed', e);
          }

          if (isAutostart) {
            useAvatarState.getState().setIsSleepMode(true);
          }
        } else {
          await setupMainWindow(false);
        }

        setIsInitializing(false);

        if (!isAutostart) {
          if (!hasApiKey && !useAvatarState.getState().isSleepMode) {
            setTimeout(() => emitCrossWindow('lucy-open-settings'), 800);
          }
        }
      };
      initWindow();
    }
  }, [licenseStatus, hasApiKey, setupMainWindow]);

  // ─── Session Verification (Concurrency Enforcement) ────────────────────────
  useEffect(() => {
    // Listen for global session changes from sign-in or a server refresh.
    const unsub = userAuth.subscribe((session) => {
      if (!session || session.status === 'revoked') {
        console.warn('[App] Session revoked or cleared. Locking app.');
        setLicenseStatus('locked');
        // Restore window so they can see AuthGate
        if (isTauriApp()) {
          try {
            const win = getCurrentWindow();
            win.unmaximize().catch(() => {});
            win.show().catch(() => {});
            win.setSkipTaskbar(false).catch(() => {});
            import('@tauri-apps/api/dpi').then(({ LogicalSize }) => {
              win.setSize(new LogicalSize(1000, 700)).catch(() => {});
              win.center().catch(() => {});
            }).catch(() => {});
          } catch (e) {
            console.warn('[App] Failed to restore window on lock:', e);
          }
        }
      }
    });

    // 2. Poll the server every 5 minutes to verify this device is still the active session
    const interval = setInterval(async () => {
      if (userAuth.getSession() && licenseStatus === 'authorized') {
        const updated = await userAuth.refreshStatus();
        if (updated?.status === 'revoked') {
           userAuth.logout(); // This will trigger the subscribe callback above
        }
      }
    }, 5 * 60 * 1000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [licenseStatus]);

  // ─── API key listener ─────────────────────────────────────────────────────
  useEffect(() => {
    const checkKey = () =>
      setHasApiKey(!!localStorage.getItem('lucy_main_api_key'));
    window.addEventListener('storage', checkKey);
    const unsubKey = listenCrossWindow('lucy-api-key-saved', checkKey);
    return () => {
      window.removeEventListener('storage', checkKey);
      unsubKey();
    };
  }, []);

  // ─── Cursor passthrough ──────────────────────────────────────────

  useEffect(() => {
    if (!isTauriApp()) return;
    let active = true;
    let lastIgnore = true;
    const win = getCurrentWindow();
    let cachedWinPos = { x: 0, y: 0 };
    let cachedFactor = 1;
    let cacheAge = 999; // Set high so it instantly grabs the true window position on first run
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = (ms: number) => {
      if (!active) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(checkMouse, ms);
    };

    const checkMouse = async () => {
      if (!active) return;
      timer = null;
      try {
        // Sleep mode: the window is fully transparent / no avatar UI is shown, so cursor
        // passthrough is irrelevant. We STOP the loop entirely (previously it woke every 1s
        // just to re-check the flag). It is restarted by the lucy-wake-up handler below.
        if (useAvatarState.getState().isSleepMode) return;

        const isVisible = await win.isVisible();
        if (!isVisible) {
          scheduleNext(1000);
          return;
        }

        let inside = false;

        if (document.querySelector('.is-dragging-window')) {
          inside = true;
        } else {
          cacheAge++;
          if (cacheAge > 25) {
            cachedWinPos = await win.outerPosition();
            cachedFactor = await win.scaleFactor();
            cacheAge = 0;
          }
          const cursor = await cursorPosition();
          const x = (cursor.x - cachedWinPos.x) / cachedFactor;
          const y = (cursor.y - cachedWinPos.y) / cachedFactor;

          const el = document.elementFromPoint(x, y);
          if (el && el.closest('.pointer-events-auto')) {
            inside = true;
          }
        }

        if (inside !== !lastIgnore) {
          lastIgnore = !inside;
          if (active) {
             try {
                await win.setIgnoreCursorEvents(lastIgnore);
             } catch (err: any) {
                console.warn('IgnoreCursorEvents error:', err);
             }
          }
        }
      } catch (e: any) {
        console.warn('checkMouse error:', e);
      }
      scheduleNext(200);
    };

    const handleSleep = () => {
      // Stop the cursor-passthrough loop while asleep; nothing interactive is on screen.
      if (timer) { clearTimeout(timer); timer = null; }
      // Explicitly set window ignore cursor events to true so desktop is 100% click-through!
      lastIgnore = true;
      win.setIgnoreCursorEvents(true).catch(() => {});
    };

    const handleWakeDebugInteractive = (event: Event) => {
      if (!useAvatarState.getState().isSleepMode) return;
      const interactive = (event as CustomEvent<boolean>).detail === true;
      lastIgnore = !interactive;
      win.setIgnoreCursorEvents(!interactive).catch(() => {});
    };

    const handleWakeUp = () => {
      lastIgnore = false; // Force re-evaluation

      // Ensure the window gets restored and maximized properly
      const win = getCurrentWindow();
      win.setAlwaysOnTop(true).catch(() => {});
      win.maximize().catch(() => {});
      win.show().catch(() => {});
      win.setIgnoreCursorEvents(false).catch(() => {});

      // Force DOM repaint to fix Windows WebView2 blank screen bug after memory trim on wake
      document.body.style.backgroundColor = 'rgba(0,0,0,0.01)';
      setTimeout(() => {
        document.body.style.backgroundColor = 'rgba(0, 0, 0, 0.005)';
      }, 10);

      // Resume the cursor-passthrough loop now that the avatar UI is back.
      if (active && !timer) {
        scheduleNext(50);
      }
    };

    // Subscribe directly to Zustand state updates with zero CPU/RAM overhead
    let prevSleep = useAvatarState.getState().isSleepMode;
    const unsubStore = useAvatarState.subscribe((state) => {
      const currentSleep = state.isSleepMode;
      if (currentSleep === prevSleep) return;
      prevSleep = currentSleep;
      if (currentSleep) {
        handleSleep();
      } else {
        handleWakeUp();
      }
    });

    const handleWakeUpEvent = () => {
      useAvatarState.getState().setIsSleepMode(false);
    };

    const handleSleepEvent = () => {
      useAvatarState.getState().setIsSleepMode(true);
    };

    const unsubSleep = listenCrossWindow('lucy-sleep', handleSleepEvent);
    const unsubWake = listenCrossWindow('lucy-wake-up', handleWakeUpEvent);
    window.addEventListener('lucy-wake-debug-interactive', handleWakeDebugInteractive);

    // Don't even start the loop if we boot directly into sleep mode.
    if (!useAvatarState.getState().isSleepMode) {
      checkMouse();
    } else if (document.querySelector('[data-wake-debug-overlay="true"]')) {
      handleWakeDebugInteractive(new CustomEvent('lucy-wake-debug-interactive', { detail: true }));
    }
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubStore();
      unsubSleep();
      unsubWake();
      window.removeEventListener('lucy-wake-debug-interactive', handleWakeDebugInteractive);
      win.setIgnoreCursorEvents(false).catch(() => {});
    };
  }, [licenseStatus]);

  return (
    <div className="h-screen w-screen relative overflow-hidden text-white font-sans flex flex-col" style={{ backgroundColor: 'rgba(0, 0, 0, 0.005)' }}>

      {!hasApiKey && licenseStatus === 'authorized' && !useAvatarState.getState().isSleepMode && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[9999] bg-pink-500/90 text-white px-6 py-3 rounded-full shadow-[0_0_20px_rgba(236,72,153,0.5)] border border-pink-400 font-bold flex items-center gap-2 animate-bounce pointer-events-auto">
          ⚠️ Please add your Gemini API Key in the Settings menu to continue.
        </div>
      )}

      <AuthGate
        onAuthorized={() => setLicenseStatus('authorized')}
      />

      <div className="flex-1 relative flex min-h-0">
        {!isInitializing && licenseStatus !== 'locked' && licenseStatus !== 'checking' && (
          <LucyOS isAuthorized={true} />
        )}
      </div>
    </div>
  );
}

