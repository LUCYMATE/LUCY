import { MyraOS } from './components/MyraOS';
import { Minus, Square, X } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';

export default function App() {
  const [isMiniMode, setIsMiniMode] = useState(false);
  const normalSizeRef = useRef<{width: number, height: number} | null>(null);
  const wasMaximizedRef = useRef<boolean>(false);

  const minimize = async () => {
    try {
      const win = getCurrentWindow();
      if (!isMiniMode) {
        // Save the current size before minimizing
        const isMax = await win.isMaximized();
        wasMaximizedRef.current = isMax;
        
        if (isMax) {
          await win.unmaximize();
        } else {
          const size = await win.outerSize();
          const factor = await win.scaleFactor();
          const logical = size.toLogical(factor);
          normalSizeRef.current = { width: logical.width, height: logical.height };
        }

        await win.setMinSize(new LogicalSize(250, 100)); // Minimum limit for mini mode
        await win.setMaxSize(new LogicalSize(600, 300)); // Maximum limit for mini mode
        await win.setAlwaysOnTop(true);
        await win.setSize(new LogicalSize(300, 150));
        setIsMiniMode(true);
      } else {
        await win.setMaxSize(null);
        await win.setMinSize(new LogicalSize(800, 600)); // Minimum limit for normal mode
        await win.setAlwaysOnTop(false);
        if (wasMaximizedRef.current) {
          await win.maximize();
        } else if (normalSizeRef.current) {
          await win.setSize(new LogicalSize(normalSizeRef.current.width, normalSizeRef.current.height));
        } else {
          await win.setSize(new LogicalSize(1000, 700));
        }
        setIsMiniMode(false);
      }
    } catch (e) {
      console.warn("Minimize resizing only works in Tauri apps", e);
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
    // Show the window smoothly after a short delay to ensure React has fully rendered the UI
    const timer = setTimeout(async () => {
      try {
        await getCurrentWindow().show();
      } catch (e) {
        // Not running in Tauri or permission missing
      }
    }, 300);
    const handleRestore = async () => {
      if (isMiniMode) {
        try {
          const win = getCurrentWindow();
          await win.setMaxSize(null);
          await win.setMinSize(new LogicalSize(800, 600));
          await win.setAlwaysOnTop(false);
          if (wasMaximizedRef.current) {
            await win.maximize();
          } else if (normalSizeRef.current) {
            await win.setSize(new LogicalSize(normalSizeRef.current.width, normalSizeRef.current.height));
          } else {
            await win.setSize(new LogicalSize(1000, 700));
          }
          setIsMiniMode(false);
        } catch (e) {
          console.warn(e);
        }
      }
    };
    window.addEventListener('myra-restore', handleRestore);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('myra-restore', handleRestore);
    };
  }, [isMiniMode]);

  return (
    <div 
      className="h-screen w-screen bg-[#020617] relative overflow-hidden text-white font-sans flex flex-col"
      data-tauri-drag-region={isMiniMode ? true : undefined}
    >
      <div className="mesh-bg" data-tauri-drag-region={isMiniMode ? true : undefined}></div>
      
      {/* Custom Titlebar */}
      {!isMiniMode && (
        <div 
          data-tauri-drag-region 
        className="h-8 flex shrink-0 justify-end items-center select-none z-50 bg-black/20 backdrop-blur-sm"
      >
        <div className="flex h-full">
          <div 
            className="w-12 h-full flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer text-white/70 hover:text-white"
            onClick={minimize}
          >
            <Minus size={16} />
          </div>
          <div 
            className="w-12 h-full flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer text-white/70 hover:text-white"
            onClick={toggleMaximize}
          >
            <Square size={14} />
          </div>
          <div 
            className="w-12 h-full flex items-center justify-center hover:bg-red-500 transition-colors cursor-pointer text-white/70 hover:text-white"
            onClick={close}
          >
            <X size={18} />
          </div>
        </div>
      </div>
      )}

      <div className="flex-1 relative flex min-h-0" data-tauri-drag-region={isMiniMode ? true : undefined}>
        <MyraOS isMiniMode={isMiniMode} />
      </div>
    </div>
  );
}
