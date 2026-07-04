import { Minus, Square, X, Menu, Wand2, Minimize2 } from 'lucide-react';

export function TitleBar({ 
  onOpenMenu, 
  onMinimize, 
  onMaximize, 
  onClose,
  onPetMode,
  onMiniMode
}: { 
  onOpenMenu: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onPetMode?: () => void;
  onMiniMode?: () => void;
}) {
  return (
    <div className="h-8 flex shrink-0 justify-between items-center select-none z-[60] bg-black/20 backdrop-blur-sm relative">
      <div className="flex h-full items-center pl-2">
        <button
          onClick={onOpenMenu}
          className="flex items-center justify-center p-1 rounded hover:bg-white/10 transition-colors cursor-pointer text-white/70 hover:text-white"
          title="Open menu"
        >
          <Menu size={16} />
        </button>
      </div>
      
      {/* The empty space acts as the drag region */}
      <div data-tauri-drag-region className="flex-1 h-full cursor-move" />
      <div className="flex h-full">

        {onPetMode && (
          <div 
            className="w-12 h-full flex items-center justify-center hover:bg-pink-500/20 transition-colors cursor-pointer text-pink-400 hover:text-pink-300"
            onClick={onPetMode}
            title="Pet Mode"
          >
            <Wand2 size={14} />
          </div>
        )}
        <div 
          className="w-12 h-full flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer text-white/70 hover:text-white"
          onClick={onMinimize}
        >
          <Minus size={16} />
        </div>
        <div 
          className="w-12 h-full flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer text-white/70 hover:text-white"
          onClick={onMaximize}
        >
          <Square size={14} />
        </div>
        <div 
          className="w-12 h-full flex items-center justify-center hover:bg-red-500 transition-colors cursor-pointer text-white/70 hover:text-white"
          onClick={onClose}
        >
          <X size={18} />
        </div>
      </div>
    </div>
  );
}
