import { MyraOS } from './components/layout/MyraOS';
import { Sidebar } from './components/layout/Sidebar';
import { TitleBar } from './components/layout/TitleBar';
import { Minus, Square, X, Menu } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi';

export default function App() {
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [isPetMode, setIsPetMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const normalSizeRef = useRef<{width: number, height: number} | null>(null);
  const normalPosRef = useRef<{x: number, y: number} | null>(null);
  const miniPosRef = useRef<{x: number, y: number} | null>(null);
  const petModePosRef = useRef<{x: number, y: number} | null>(null);

  const restoreWindow = async () => {
    const safe = async (p: Promise<any>) => {
      try { await p; } catch (e) { console.warn('Tauri API error:', e); }
    };
    try {
      const win = getCurrentWindow();
      
      // Save mini mode position before restoring
      try {
        const pos = await win.outerPosition();
        const factor = await win.scaleFactor();
        const logicalPos = pos.toLogical(factor);
        miniPosRef.current = { x: logicalPos.x, y: logicalPos.y };
      } catch (e) {
        console.warn("Could not save mini position", e);
      }

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
      setIsMiniMode(false);
      setIsPetMode(false);
    } catch (e) {
      console.warn("Fallback: window api totally failed", e);
      setIsMiniMode(false); 
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
        setIsMiniMode(false);
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
    
    window.addEventListener('myra-restore', onRestore);
    window.addEventListener('myra-exit-pet-mode', onExitPetMode);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('myra-restore', onRestore);
      window.removeEventListener('myra-exit-pet-mode', onExitPetMode);
    };
  }, []);

  useEffect(() => {
    const setupShortcuts = async () => {
      try {
        await register('CommandOrControl+Shift+M', () => {
          window.dispatchEvent(new CustomEvent('myra-toggle-mic'));
        });
        await register('CommandOrControl+Shift+X', () => {
          window.dispatchEvent(new CustomEvent('myra-exit-pet-mode'));
        });
        await register('CommandOrControl+Shift+S', () => {
          window.dispatchEvent(new CustomEvent('myra-toggle-mute'));
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
      data-tauri-drag-region={isMiniMode ? true : undefined}
    >
      {!isPetMode && <div className="mesh-bg" data-tauri-drag-region={isMiniMode ? true : undefined}></div>}
      
      {/* Custom Titlebar */}
      {!isMiniMode && !isPetMode && (
        <TitleBar 
          onOpenMenu={() => setSidebarOpen(true)}
          onMinimize={minimize}
          onMaximize={toggleMaximize}
          onClose={close}
          onPetMode={togglePetMode}
        />
      )}

      {/* ── Sliding Sidebar Overlay ── */}
      {!isMiniMode && !isPetMode && sidebarOpen && (
        <Sidebar onClose={() => setSidebarOpen(false)} />
      )}

      <div className="flex-1 relative flex min-h-0" data-tauri-drag-region={isMiniMode ? true : undefined}>
        <MyraOS isMiniMode={isMiniMode} isPetMode={isPetMode} />
      </div>
    </div>
  );
}
