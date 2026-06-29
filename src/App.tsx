import { MyraOS } from './components/layout/MyraOS';
import { Sidebar } from './components/layout/Sidebar';
import { TitleBar } from './components/layout/TitleBar';
import { Minus, Square, X, Menu } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi';

export default function App() {
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const normalSizeRef = useRef<{width: number, height: number} | null>(null);
  const normalPosRef = useRef<{x: number, y: number} | null>(null);
  const miniPosRef = useRef<{x: number, y: number} | null>(null);

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
    } catch (e) {
      console.warn("Fallback: window api totally failed", e);
      setIsMiniMode(false); // Always apply UI state
    }
  };

  const minimize = async () => {
    // Helper to safely execute Tauri commands without breaking the flow
    const safe = async (p: Promise<any>) => {
      try { await p; } catch (e) { console.warn('Tauri API error:', e); }
    };

    try {
      const win = getCurrentWindow();
      if (!isMiniMode) {
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

        await safe(win.setMaxSize(null)); // clear max first
        await safe(win.setMinSize(new LogicalSize(250, 90)));
        await safe(win.setAlwaysOnTop(true));
        
        // Restore mini position if we have one
        if (miniPosRef.current) {
          await safe(win.setPosition(new LogicalPosition(miniPosRef.current.x, miniPosRef.current.y)));
        }
        
        await safe(win.setSize(new LogicalSize(350, 100)));
        await safe(win.setMaxSize(new LogicalSize(600, 150))); // set max after shrinking

        setIsMiniMode(true);
      } else {
        await restoreWindow();
      }
    } catch (e) {
      console.warn("Fallback: window api totally failed", e);
      setIsMiniMode(!isMiniMode); // Always apply UI state
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
    
    window.addEventListener('myra-restore', onRestore);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('myra-restore', onRestore);
    };
  }, []);

  return (
    <div 
      className="h-screen w-screen bg-[#020617] relative overflow-hidden text-white font-sans flex flex-col"
      data-tauri-drag-region={isMiniMode ? true : undefined}
    >
      <div className="mesh-bg" data-tauri-drag-region={isMiniMode ? true : undefined}></div>
      
      {/* Custom Titlebar */}
      {!isMiniMode && (
        <TitleBar 
          onOpenMenu={() => setSidebarOpen(true)}
          onMinimize={minimize}
          onMaximize={toggleMaximize}
          onClose={close}
        />
      )}

      {/* ── Sliding Sidebar Overlay ── */}
      {!isMiniMode && sidebarOpen && (
        <Sidebar onClose={() => setSidebarOpen(false)} />
      )}

      <div className="flex-1 relative flex min-h-0" data-tauri-drag-region={isMiniMode ? true : undefined}>
        <MyraOS isMiniMode={isMiniMode} />
      </div>
    </div>
  );
}
