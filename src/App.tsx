import { MyraOS } from './components/layout/MyraOS';
import { Sidebar } from './components/layout/Sidebar';
import { TitleBar } from './components/layout/TitleBar';
import { Minus, Square, X, Menu } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { getCurrentWindow, currentMonitor, cursorPosition } from '@tauri-apps/api/window';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi';

export default function App() {
  const [isPetMode, setIsPetMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const normalSizeRef = useRef<{width: number, height: number} | null>(null);
  const normalPosRef  = useRef<{x: number, y: number} | null>(null);
  const petModePosRef = useRef<{x: number, y: number} | null>(null);

  const restoreWindow = async () => {
    const safe = async (p: Promise<any>) => {
      try { await p; } catch (e) { console.warn('Tauri API error:', e); }
    };
    try {
      const win = getCurrentWindow();

      await safe(win.setMaxSize(null));
      await safe(win.setAlwaysOnTop(false));
      await safe(win.setFullscreen(false));
      await safe(win.setSkipTaskbar(false));
      await safe(win.setIgnoreCursorEvents(false));

      try {
        if (normalSizeRef.current) {
          await win.setSize(new LogicalSize(normalSizeRef.current.width, normalSizeRef.current.height));
        } else {
          await win.setSize(new LogicalSize(1000, 700));
        }
        if (normalPosRef.current) {
          await win.setPosition(new LogicalPosition(normalPosRef.current.x, normalPosRef.current.y));
        }
      } catch (e) {
        console.warn("Could not restore size and position", e);
      }

      await safe(win.setMinSize(new LogicalSize(800, 600)));
      setIsPetMode(false);
    } catch (e) {
      console.warn("Fallback: window api totally failed", e);
      setIsPetMode(false);
    }
  };

  const minimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (e) {
      console.warn("Minimize only works in Tauri apps");
    }
  };

  const togglePetMode = async () => {
    const safe = async (p: Promise<any>) => {
      try { await p; } catch (e) { console.warn('Tauri API error:', e); }
    };

    try {
      const win = getCurrentWindow();
      if (!isPetMode) {
        try {
          const isMax = await win.isMaximized();
          if (isMax) {
            await win.unmaximize();
          }
          
          const size = await win.outerSize();
          const pos = await win.outerPosition();
          const factor = await win.scaleFactor();
          
          const logicalSize = size.toLogical(factor);
          const logicalPos = pos.toLogical(factor);
          
          normalSizeRef.current = { width: logicalSize.width, height: logicalSize.height };
          normalPosRef.current = { x: logicalPos.x, y: logicalPos.y };
        } catch (e) {
          console.warn("Could not read window size/pos", e);
        }

        await safe(win.setMaxSize(null));
        await safe(win.setFullscreen(true));
        await safe(win.setSkipTaskbar(true));
        
        await safe(win.setAlwaysOnTop(true));
        await safe(win.setIgnoreCursorEvents(true));

        setIsPetMode(true);
      } else {
        await restoreWindow();
      }
    } catch (e) {
      console.warn("Fallback: window api totally failed", e);
      setIsPetMode(!isPetMode);
    }
  };

  const toggleMaximize = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
    } catch (e) {
      console.warn("Maximize only works in Tauri apps");
    }
  };

  const close = async () => {
    try {
      await getCurrentWindow().close();
    } catch (e) {
      console.warn("Close only works in Tauri apps");
    }
  };

  useEffect(() => {
    const initWindow = async () => {
      try {
        await getCurrentWindow().show();
        // Auto-launch into pet mode if the user has it enabled
        if (localStorage.getItem('myra_launch_pet_mode') === 'true') {
          togglePetMode();
        }
      } catch (e) {
        // Not running in Tauri or permission missing
      }
    };
    initWindow();
    
    const onRestore = () => {
      restoreWindow();
    };
    
    const onExitPetMode = () => {
      restoreWindow();
    };
    
    window.addEventListener('myra-restore', onRestore);
    window.addEventListener('myra-exit-pet-mode', onExitPetMode);

    return () => {
      window.removeEventListener('myra-restore', onRestore);
      window.removeEventListener('myra-exit-pet-mode', onExitPetMode);
    };
  }, []);

  useEffect(() => {
    if (!isPetMode) return;

    let active = true;
    let lastIgnore = true;

    const checkMouse = async () => {
      if (!active) return;
      try {
        const win = getCurrentWindow();
        const cursor = await cursorPosition();
        const winPos = await win.outerPosition();
        const factor = await win.scaleFactor();

        // Convert cursor to logical coordinates relative to viewport
        const x = (cursor.x - winPos.x) / factor;
        const y = (cursor.y - winPos.y) / factor;

        // Find elements with pointer-events-auto
        const elements = document.querySelectorAll('.pointer-events-auto');
        
        let insideInteractive = false;
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          const rect = el.getBoundingClientRect();
          if (
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
          ) {
            insideInteractive = true;
            break;
          }
        }

        if (insideInteractive !== !lastIgnore) {
          lastIgnore = !insideInteractive;
          await win.setIgnoreCursorEvents(lastIgnore);
        }
      } catch (e) {
        console.warn("Error in pet mode mouse tracking:", e);
      }

      if (active) {
        setTimeout(checkMouse, 50); // check every 50ms
      }
    };

    checkMouse();

    return () => {
      active = false;
      getCurrentWindow().setIgnoreCursorEvents(false).catch(() => {});
    };
  }, [isPetMode]);

  useEffect(() => {
    const setupShortcuts = async () => {
      try {
        await register('CommandOrControl+Alt+M', () => {
          window.dispatchEvent(new CustomEvent('myra-toggle-mic'));
        });
        await register('CommandOrControl+Alt+X', () => {
          window.dispatchEvent(new CustomEvent('myra-exit-pet-mode'));
        });
        await register('CommandOrControl+Alt+S', () => {
          window.dispatchEvent(new CustomEvent('myra-toggle-mute'));
        });
      } catch (e) {
        console.warn('Failed to register global shortcuts', e);
      }
    };
    setupShortcuts();

    return () => {
      unregister('CommandOrControl+Alt+M').catch(() => {});
      unregister('CommandOrControl+Alt+X').catch(() => {});
      unregister('CommandOrControl+Alt+S').catch(() => {});
    };
  }, []);

  return (
    <div 
      className={`h-screen w-screen relative overflow-hidden text-white font-sans flex flex-col ${isPetMode ? 'bg-transparent' : 'bg-[#020617]'}`}
    >
      {!isPetMode && <div className="mesh-bg"></div>}
      
      {/* Custom Titlebar */}
      {!isPetMode && (
        <TitleBar 
          onOpenMenu={() => setSidebarOpen(true)}
          onMinimize={minimize}
          onMaximize={toggleMaximize}
          onClose={close}
          onPetMode={togglePetMode}
        />
      )}

      {/* ── Sliding Sidebar Overlay ── */}
      {!isPetMode && sidebarOpen && (
        <Sidebar onClose={() => setSidebarOpen(false)} />
      )}

      <div className="flex-1 relative flex min-h-0">
        <MyraOS isPetMode={isPetMode} />
      </div>
    </div>
  );
}
