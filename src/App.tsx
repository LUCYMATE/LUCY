import { SoltiniOS } from './components/layout/SoltiniOS';
import { LicenseGate } from './components/LicenseGate';
import { useEffect, useState, useCallback, useRef } from 'react';
import { getCurrentWindow, cursorPosition } from '@tauri-apps/api/window';
import { useAvatarState } from './lib/store/avatarState';

const LICENSE_SERVER_URL = 'https://soltini.vercel.app';

const safe = async (p: Promise<any>) => {
  try { await p; } catch (e) { console.warn('Tauri API error:', e); }
};

export default function App() {
  const [licenseStatus, setLicenseStatus] = useState<'checking' | 'locked' | 'authorized'>('checking');
  const [hasApiKey, setHasApiKey] = useState(() =>
    !!localStorage.getItem('soltini_main_api_key') || !!import.meta.env.VITE_GEMINI_API_KEY
  );

  const windowReadyRef = useRef(false);

  const setupMainWindow = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      // Hide from taskbar now that authentication is complete
      await safe(win.setSkipTaskbar(true));
      
      await safe(win.maximize());
      await safe(win.setIgnoreCursorEvents(true));
      
      windowReadyRef.current = true;
      window.dispatchEvent(new CustomEvent('soltini-force-init'));
    } catch (e) {
      console.warn('setupMainWindow failed', e);
    }
  }, []);

  useEffect(() => {
    if (licenseStatus === 'authorized') {
      const initWindow = async () => {
        await setupMainWindow();
        const win = getCurrentWindow();
        await safe(win.show());
        
        if (!hasApiKey) {
          setTimeout(() => window.dispatchEvent(new CustomEvent('soltini-open-settings')), 800);
        }
      };
      initWindow();
    }
  }, [licenseStatus, hasApiKey, setupMainWindow]);

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

  useEffect(() => {
    if (licenseStatus !== 'authorized') return;
    let active = true;
    let lastIgnore = true;
    const win = getCurrentWindow();
    let cachedWinPos = { x: 0, y: 0 };
    let cachedFactor = 1;
    let cacheAge = 999; // Set high so it instantly grabs the true window position on first run

    const checkMouse = async () => {
      if (!active) return;
      try {
        if (useAvatarState.getState().isSleepMode) {
          if (active) setTimeout(checkMouse, 1000);
          return;
        }

        const isVisible = await win.isVisible();
        if (!isVisible) {
          if (active) setTimeout(checkMouse, 1000);
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
      if (active) setTimeout(checkMouse, 200);
    };

    const handleWakeUp = () => {
      lastIgnore = false; // Force re-evaluation
      // Force DOM repaint to fix Windows WebView2 blank screen bug after memory trim on wake
      document.body.style.backgroundColor = 'rgba(0,0,0,0.01)';
      setTimeout(() => {
        document.body.style.backgroundColor = 'transparent';
      }, 10);
    };
    window.addEventListener('soltini-wake-up', handleWakeUp);

    checkMouse();
    return () => {
      active = false;
      window.removeEventListener('soltini-wake-up', handleWakeUp);
      win.setIgnoreCursorEvents(false).catch(() => {});
    };
  }, [licenseStatus]);

  return (
    <div className="h-screen w-screen relative overflow-hidden text-white font-sans flex flex-col bg-transparent">

      {!hasApiKey && licenseStatus === 'authorized' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[9999] bg-pink-500/90 text-white px-6 py-3 rounded-full shadow-[0_0_20px_rgba(236,72,153,0.5)] border border-pink-400 font-bold flex items-center gap-2 animate-bounce pointer-events-auto">
          ⚠️ Please add your Gemini API Key in the Settings menu to continue.
        </div>
      )}

      <LicenseGate
        onAuthorized={() => setLicenseStatus('authorized')}
        onRequireActivation={async () => {
          setLicenseStatus('locked');
        }}
        serverUrl={LICENSE_SERVER_URL}
      />

      <div className="flex-1 relative flex min-h-0">
        {licenseStatus !== 'locked' && licenseStatus !== 'checking' && (
          <SoltiniOS isAuthorized={true} />
        )}
      </div>
    </div>
  );
}
