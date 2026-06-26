import { MyraOS } from './components/MyraOS';
import { Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';

export default function App() {
  const [isMiniMode, setIsMiniMode] = useState(false);

  const minimize = async () => {
    try {
      const win = getCurrentWindow();
      if (!isMiniMode) {
        await win.setAlwaysOnTop(true);
        await win.setSize(new LogicalSize(300, 150));
        setIsMiniMode(true);
      } else {
        await win.setAlwaysOnTop(false);
        await win.setSize(new LogicalSize(1000, 700));
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
          await win.setAlwaysOnTop(false);
          await win.setSize(new LogicalSize(1000, 700));
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
    <div className="h-screen w-screen bg-[#020617] relative overflow-hidden text-white font-sans flex flex-col">
      <div className="mesh-bg"></div>
      
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
      )}

      <div className="flex-1 relative flex min-h-0">
        <MyraOS isMiniMode={isMiniMode} />
      </div>
    </div>
  );
}
