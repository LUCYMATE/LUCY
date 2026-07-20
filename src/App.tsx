import { SoltiniOS } from './components/layout/SoltiniOS';
import { Sidebar } from './components/layout/Sidebar';
import { TitleBar } from './components/layout/TitleBar';
import { LicenseGate } from './components/LicenseGate';
import { useEffect, useState, useRef, useCallback } from 'react';
import { getCurrentWindow, cursorPosition } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi';

const LICENSE_SERVER_URL = 'https://soltini.vercel.app';

const safe = async (p: Promise<any>) => {
  try { await p; } catch (e) { console.warn('Tauri API error:', e); }
};

export default function App() {
  const [isPetMode, setIsPetMode] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Optimistic: assume authorized until the background check says otherwise
  const [licenseLocked, setLicenseLocked] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(() =>
    !!localStorage.getItem('soltini_main_api_key') || !!import.meta.env.VITE_GEMINI_API_KEY
  );

  const effectivePetMode = isPetMode && !licenseLocked && hasApiKey;

  const windowReadyRef = useRef(false);
  const normalSizeRef = useRef<{ width: number; height: number } | null>(null);
  const normalPosRef = useRef<{ x: number; y: number } | null>(null);

  // Show the window immediately on mount in transparent pet-mode state.
  // The avatar's own Suspense loader (pulsing orb) will show in place of
  // the model while the 3D scene and VRM file load — no full-screen cover needed.
  useEffect(() => {
    const win = getCurrentWindow();
    safe(win.show());
  }, []);

  // ─── Configure window for pet-mode overlay ────────────────────────────────
  const enterPetModeWindow = useCallback(async () => {
    try {
      const win = getCurrentWindow();

      // Snapshot normal size/pos for later restore
      if (!normalSizeRef.current) {
        try {
          const isMax = await win.isMaximized();
          if (!isMax) {
            const size   = await win.outerSize();
            const pos    = await win.outerPosition();
            const factor = await win.scaleFactor();
            normalSizeRef.current = {
              width:  size.toLogical(factor).width,
              height: size.toLogical(factor).height,
            };
            normalPosRef.current = {
              x: pos.toLogical(factor).x,
              y: pos.toLogical(factor).y,
            };
          }
        } catch (_) {}
      }

      await safe(win.setDecorations(false));
      await safe(win.setSkipTaskbar(true));
      await safe(win.setMaxSize(null));
      await safe(win.setResizable(false));
      await safe(win.setShadow(false));
      await safe(win.setAlwaysOnTop(true));
      await safe(win.setIgnoreCursorEvents(true));
      await safe(win.maximize());
      await safe(win.setFullscreen(false));

      windowReadyRef.current = true;
      setIsPetMode(true);
      window.dispatchEvent(new CustomEvent('soltini-force-init'));
    } catch (e) {
      console.warn('enterPetModeWindow failed', e);
      setIsPetMode(true);
    }
  }, []);

  // ─── Restore to normal desktop window ────────────────────────────────────
  const restoreWindow = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      await safe(win.setAlwaysOnTop(false));
      await safe(win.setSkipTaskbar(false));
      await safe(win.setIgnoreCursorEvents(false));
      await safe(win.setShadow(true));
      await safe(win.setDecorations(false));
      await safe(win.setResizable(true));
      await safe(win.setMaxSize(null));
      await safe(win.setFullscreen(false));

      const targetW = normalSizeRef.current?.width  ?? 1000;
      const targetH = normalSizeRef.current?.height ?? 700;
      await safe(win.setSize(new LogicalSize(targetW, targetH)));

      if (normalPosRef.current) {
        await safe(win.setPosition(new LogicalPosition(normalPosRef.current.x, normalPosRef.current.y)));
      } else {
        await safe(win.center());
      }
      await safe(win.setMinSize(new LogicalSize(800, 600)));
      setIsPetMode(false);
    } catch (e) {
      console.warn('restoreWindow failed', e);
      setIsPetMode(false);
    }
  }, []);

  const minimize       = async () => { try { await getCurrentWindow().minimize();       } catch (_) {} };
  const toggleMaximize = async () => { try { await getCurrentWindow().toggleMaximize(); } catch (_) {} };
  const close          = async () => { try { await getCurrentWindow().close();           } catch (_) {} };

  // ─── Sync effectivePetMode → window state ────────────────────────────────
  useEffect(() => {
    if (effectivePetMode) {
      enterPetModeWindow();
    } else {
      if (windowReadyRef.current) {
        restoreWindow();
      }
      windowReadyRef.current = true;

      if (!licenseLocked && !hasApiKey) {
        setTimeout(() => window.dispatchEvent(new CustomEvent('soltini-open-settings')), 800);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePetMode]);

  // ─── Global events ────────────────────────────────────────────────────────
  useEffect(() => {
    const onRestore  = () => restoreWindow();
    const onEnterPet = () => setIsPetMode(true);
    window.addEventListener('soltini-restore', onRestore);
    window.addEventListener('soltini-enter-pet-mode', onEnterPet);

    let unlistenExit: (() => void) | undefined;
    listen('soltini-exit-pet-mode', () => restoreWindow())
      .then(fn => { unlistenExit = fn; });

    return () => {
      window.removeEventListener('soltini-restore', onRestore);
      window.removeEventListener('soltini-enter-pet-mode', onEnterPet);
      unlistenExit?.();
    };
  }, [restoreWindow]);

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

  // ─── Pet-mode cursor passthrough ──────────────────────────────────────────
  useEffect(() => {
    if (!effectivePetMode) return;
    let active = true;
    let lastIgnore = true;
    const win = getCurrentWindow();

    const checkMouse = async () => {
      if (!active) return;
      try {
        const cursor = await cursorPosition();
        const winPos = await win.outerPosition();
        const factor = await win.scaleFactor();
        const x = (cursor.x - winPos.x) / factor;
        const y = (cursor.y - winPos.y) / factor;

        const elements = document.querySelectorAll('.pointer-events-auto');
        let inside = false;
        for (const el of Array.from(elements)) {
          const r = el.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            inside = true;
            break;
          }
        }
        if (inside !== !lastIgnore) {
          lastIgnore = !inside;
          if (active) await win.setIgnoreCursorEvents(lastIgnore);
        }
      } catch (e) {
        console.warn('pet mode mouse error:', e);
      }
      if (active) setTimeout(checkMouse, 200);
    };

    checkMouse();
    return () => {
      active = false;
      win.setIgnoreCursorEvents(false).catch(() => {});
    };
  }, [effectivePetMode]);

  return (
    <div className={`h-screen w-screen relative overflow-hidden text-white font-sans flex flex-col ${
      effectivePetMode ? 'bg-transparent' : 'bg-[#020617]'
    }`}>

      {/* API key missing banner */}
      {!hasApiKey && !licenseLocked && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[9999] bg-pink-500/90 text-white px-6 py-3 rounded-full shadow-[0_0_20px_rgba(236,72,153,0.5)] border border-pink-400 font-bold flex items-center gap-2 animate-bounce">
          ⚠️ Please add your Gemini API Key in the Settings menu to continue.
        </div>
      )}

      {/* License gate — invisible while checking; opaque only when locked */}
      <LicenseGate
        onAuthorized={() => setLicenseLocked(false)}
        onRequireActivation={async () => {
          setLicenseLocked(true);
        }}
        serverUrl={LICENSE_SERVER_URL}
      />

      {!effectivePetMode && <div className="mesh-bg" />}

      {/* Custom Titlebar */}
      {!effectivePetMode && (
        <TitleBar
          onOpenMenu={() => setSidebarOpen(prev => !prev)}
          onMinimize={minimize}
          onMaximize={toggleMaximize}
          onClose={close}
          onPetMode={() => setIsPetMode(true)}
        />
      )}

      {/* Sliding Sidebar */}
      {!effectivePetMode && sidebarOpen && (
        <Sidebar onClose={() => setSidebarOpen(false)} />
      )}

      <div className="flex-1 relative flex min-h-0">
        <SoltiniOS isPetMode={effectivePetMode} />
      </div>
    </div>
  );
}
