import { SoltiniOS } from './components/layout/SoltiniOS';
import { AuthGate } from './components/AuthGate';
import { useEffect, useState, useCallback, useRef } from 'react';
import { getCurrentWindow, cursorPosition } from '@tauri-apps/api/window';
import { useAvatarState } from './lib/store/avatarState';
import { onOpenUrl, register } from '@tauri-apps/plugin-deep-link';
import { userAuth } from './lib/auth/userAuth';
import { invoke } from '@tauri-apps/api/core';
import { useWindowPassthrough } from './hooks/useWindowPassthrough';

const LICENSE_SERVER_URL = 'https://soltini.vercel.app';

const safe = async (p: Promise<any>) => {
  try { await p; } catch (e) { console.warn('Tauri API error:', e); }
};

export default function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [licenseStatus, setLicenseStatus] = useState<'checking' | 'locked' | 'authorized'>('checking');
  const [hasApiKey, setHasApiKey] = useState(() =>
    !!localStorage.getItem('soltini_main_api_key') || !!import.meta.env.VITE_GEMINI_API_KEY
  );

  const windowReadyRef = useRef(false);

  // Deep Link listener
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupDeepLink = async () => {
      try {
        // Register soltini:// protocol on Linux desktop
        register('soltini').catch(() => {});
        const handleLink = async (url: string) => {
          // Handle multiple deep link formats
          // Handle multiple deep link formats
          let token: string | null = null;
          let state: string | null = null;
          try {
            const urlObj = new URL(url);
            token = urlObj.searchParams.get('token') || urlObj.searchParams.get('t');
            state = urlObj.searchParams.get('state');
          } catch (_) {}

          if (!token) {
            const matchToken = url.match(/[?#&/]?token=([^&\s]+)/);
            if (matchToken) token = decodeURIComponent(matchToken[1]);
            const matchState = url.match(/[?#&/]?state=([^&\s]+)/);
            if (matchState) state = decodeURIComponent(matchState[1]);
          }

          if (token) {
            const expectedState = localStorage.getItem('soltini_auth_state');
            if (!expectedState || state !== expectedState) {
              console.warn('[DeepLink] Invalid or missing state parameter. Ignoring token.');
              window.dispatchEvent(new CustomEvent('soltini-auth-error', { detail: 'Security mismatch. The login request may have expired or was initiated from another tab.' }));
              return;
            }
            localStorage.removeItem('soltini_auth_state');
            console.log('[DeepLink] Received token, parsing...');
            const success = await userAuth.parseAndSetToken(token);
            if (success) {
              const session = userAuth.getSession();
              if (session && session.status !== 'revoked') {
                setLicenseStatus('authorized');
                try { await getCurrentWindow().setAlwaysOnTop(true); } catch (_) {}
              } else {
                setLicenseStatus('locked');
              }
            } else {
              window.dispatchEvent(new CustomEvent('soltini-auth-error', { detail: 'Token verification failed. Please try again.' }));
            }
          }
        };

        // Listen for the official deep link plugin (works on first instance)
        unlisten = await onOpenUrl(async (urls) => {
          for (const url of urls) await handleLink(url);
        });

        // Listen for the manual event emitted by the single-instance plugin (works when a second instance was spawned)
        const { listen } = await import('@tauri-apps/api/event');
        const unlistenEvent = await listen<string>('soltini-deep-link-manual', (e) => {
          handleLink(e.payload);
        });
        
        // Ensure both unlisteners are called
        const originalUnlisten = unlisten;
        unlisten = () => {
            if (originalUnlisten) originalUnlisten();
            unlistenEvent();
        };

      } catch (e) {
        console.warn('Deep link setup failed', e);
      }
    };
    setupDeepLink();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Early boot check to show the window if launched manually
  useEffect(() => {
    const bootCheck = async () => {
      try {
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

  const setupMainWindow = useCallback(async (isHidden = false) => {
    try {
      const win = getCurrentWindow();
      
      if (!isHidden) {
        await safe(win.setAlwaysOnTop(true)); // Force restore alwaysOnTop
        await safe(win.maximize());
        await safe(win.show());
        await safe(win.setIgnoreCursorEvents(true)); // Force click-through mode on login restore
      }
      
      // Hide from taskbar now that authentication is complete. 
      // This MUST be called after maximize(), because Windows restores the taskbar icon when a window is maximized!
      await safe(win.setSkipTaskbar(true));
      
      windowReadyRef.current = true;
      window.dispatchEvent(new CustomEvent('soltini-force-init'));
    } catch (e) {
      console.warn('setupMainWindow failed', e);
    }
  }, []);

  useEffect(() => {
    if (licenseStatus === 'authorized') {
      const initWindow = async () => {
        let isAutostart = false;
        try {
          isAutostart = await invoke<boolean>('is_autostart');
        } catch(e) {}
        
        await setupMainWindow(isAutostart);
        const win = getCurrentWindow();
        try {
          const autostartPlugin = await import('@tauri-apps/plugin-autostart');
          const autostartEnabled = await autostartPlugin.isEnabled();
          if (!autostartEnabled) {
            await autostartPlugin.enable();
          }
          isAutostart = await invoke<boolean>('is_autostart');
          if (isAutostart) {
            useAvatarState.getState().setIsSleepMode(true);
            // We don't need to dispatch soltini-sleep here because useCoreEngine hasn't mounted yet.
            // It will check the store when it mounts.
          }
        } catch (e) {
          console.warn('autostart check failed', e);
        }

        setIsInitializing(false);

        if (!isAutostart) {
          if (!hasApiKey && !useAvatarState.getState().isSleepMode) {
            setTimeout(() => window.dispatchEvent(new CustomEvent('soltini-open-settings')), 800);
          }
        }
      };
      initWindow();
    }
  }, [licenseStatus, hasApiKey, setupMainWindow]);

  // ─── Session Verification (Concurrency Enforcement) ────────────────────────
  useEffect(() => {
    // 1. Listen for global session changes (e.g. from refreshStatus or deep links)
    const unsub = userAuth.subscribe((session) => {
      if (!session || session.status === 'revoked') {
        console.warn('[App] Session revoked or cleared. Locking app.');
        setLicenseStatus('locked');
        // Restore window so they can see AuthGate
        const win = getCurrentWindow();
        win.unmaximize().catch(() => {});
        win.show().catch(() => {});
        win.setSkipTaskbar(false).catch(() => {});
        import('@tauri-apps/api/dpi').then(({ LogicalSize }) => {
          win.setSize(new LogicalSize(1000, 700)).catch(() => {});
          win.center().catch(() => {});
        }).catch(() => {});
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
      setHasApiKey(!!localStorage.getItem('soltini_main_api_key') || !!import.meta.env.VITE_GEMINI_API_KEY);
    window.addEventListener('storage', checkKey);
    window.addEventListener('soltini-api-key-saved', checkKey);
    return () => {
      window.removeEventListener('storage', checkKey);
      window.removeEventListener('soltini-api-key-saved', checkKey);
    };
  }, []);

  // ─── Cursor passthrough ──────────────────────────────────────────
  useWindowPassthrough(licenseStatus);

  return (
    <div className="h-screen w-screen relative overflow-hidden text-white font-sans flex flex-col" style={{ backgroundColor: 'rgba(0, 0, 0, 0.005)' }}>

      {!hasApiKey && licenseStatus === 'authorized' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[9999] bg-pink-500/90 text-white px-6 py-3 rounded-full shadow-[0_0_20px_rgba(236,72,153,0.5)] border border-pink-400 font-bold flex items-center gap-2 animate-bounce pointer-events-auto">
          ⚠️ Please add your Gemini API Key in the Settings menu to continue.
        </div>
      )}

      <AuthGate
        onAuthorized={() => setLicenseStatus('authorized')}
      />

      <div className="flex-1 relative flex min-h-0">
        {!isInitializing && licenseStatus !== 'locked' && licenseStatus !== 'checking' && (
          <SoltiniOS isAuthorized={true} />
        )}
      </div>
    </div>
  );
}
