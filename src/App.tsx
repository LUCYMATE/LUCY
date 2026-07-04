import { SyraOS } from './components/layout/SyraOS';
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
  const normalPosRef = useRef<{x: number, y: number} | null>(null);
  const petModePosRef = useRef<{x: number, y: number} | null>(null);

  const restoreWindow = async () => {
    const safe = async (p: Promise<any>) => {
      try { await p; } catch (e) { console.warn('Tauri API error:', e); }
    };
    try {
      const win = getCurrentWindow();
      


      await safe(win.setMaxSize(null));
      await safe(win.setAlwaysOnTop(false));
      await safe(win.setIgnoreCursorEvents(false));

      try {
        // Always restore the normal size first so the OS remembers the correct unmaximized size
        if (normalSizeRef.current) {
          await win.setSize(new LogicalSize(normalSizeRef.current.width, normalSizeRef.current.height));
        } else {
          await win.setSize(new LogicalSize(1000, 700));
        }

        // Restore normal position
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
        await safe(win.maximize());
        
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
    const timer = setTimeout(async () => {
      try {
        await getCurrentWindow().show();
        if (localStorage.getItem('syra_launch_pet_mode') === 'true') {
          togglePetMode();
        }
      } catch (e) {
        // Not running in Tauri or permission missing
      }
    }, 300);
    
    const onRestore = () => {
      restoreWindow();
    };
    
    const onExitPetMode = () => {
      restoreWindow();
    };
    
    window.addEventListener('syra-restore', onRestore);
    window.addEventListener('syra-exit-pet-mode', onExitPetMode);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('syra-restore', onRestore);
      window.removeEventListener('syra-exit-pet-mode', onExitPetMode);
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
        await register('CommandOrControl+Shift+M', () => {
          window.dispatchEvent(new CustomEvent('syra-toggle-mic'));
        });
        await register('CommandOrControl+Shift+X', () => {
          window.dispatchEvent(new CustomEvent('syra-exit-pet-mode'));
        });
        await register('CommandOrControl+Shift+S', () => {
          window.dispatchEvent(new CustomEvent('syra-toggle-mute'));
        });
      } catch (e) {
        console.warn('Failed to register global shortcuts', e);
      }
    };
    setupShortcuts();

    return () => {
      unregister('CommandOrControl+Shift+M').catch(() => {});
      unregister('CommandOrControl+Shift+X').catch(() => {});
      unregister('CommandOrControl+Shift+S').catch(() => {});
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
        <SyraOS isPetMode={isPetMode} />
      </div>
    </div>
  );
}
