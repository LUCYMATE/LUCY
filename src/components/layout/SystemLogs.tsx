import { Activity, Cpu, Server, Terminal, X } from 'lucide-react';
import { DraggableWindow } from './DraggableWindow';
import { LogEntry } from '../../lib/store/logger';
import { useRef, useEffect } from 'react';

export function SystemLogs({
  isVisible,
  onClose,
  logs,
  cpu,
  memory,
  latency,
  isTauri,
  isSecondaryWindow = false
}: {
  isVisible: boolean;
  onClose: () => void;
  logs: LogEntry[];
  cpu: number | string;
  memory: string;
  latency: string;
  isTauri: boolean;
  isSecondaryWindow?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isVisible]);

  if (!isVisible) return null;

  const content = (
    <div className={`w-full h-full bg-[#181818] flex flex-col relative overflow-hidden ${isSecondaryWindow ? '' : 'rounded-[24px] border border-white/20'}`}>
      
      {/* Header */}
      <div className={`${isSecondaryWindow ? '' : 'logs-drag-handle cursor-move'} shrink-0 p-4 flex items-center justify-between border-b border-white/5 bg-black/20`}>
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-purple-400" />
              <span className="text-white/90 font-medium text-sm tracking-wide">System Logs</span>
            </div>
            <button onClick={onClose} className="cancel-drag p-1 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* System Usage Stats */}
          <div className="p-4 grid grid-cols-3 gap-2 border-b border-white/5 bg-black/30 shrink-0 cancel-drag">
            <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-white/5 border border-white/5">
              <Activity className="w-4 h-4 text-pink-400 mb-1" />
              <span className="text-[10px] text-white/50 uppercase tracking-widest font-mono">Ping</span>
              <span className="text-xs font-mono font-medium text-white/90">{latency}</span>
            </div>
            <div className={`flex flex-col items-center justify-center p-2 rounded-xl bg-white/5 border border-white/5 ${!isTauri ? 'opacity-50' : ''}`}>
              <Cpu className="w-4 h-4 text-blue-400 mb-1" />
              <span className="text-[10px] text-white/50 uppercase tracking-widest font-mono">CPU</span>
              <span className="text-xs font-mono font-medium text-white/90">{isTauri ? `${cpu}%` : 'N/A'}</span>
            </div>
            <div className={`flex flex-col items-center justify-center p-2 rounded-xl bg-white/5 border border-white/5 ${!isTauri ? 'opacity-50' : ''}`}>
              <Server className="w-4 h-4 text-green-400 mb-1" />
              <span className="text-[10px] text-white/50 uppercase tracking-widest font-mono">RAM</span>
              <span className="text-xs font-mono font-medium text-white/90">{isTauri ? memory : 'N/A'}</span>
            </div>
          </div>

          {/* Logs Terminal */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 bg-black/60 font-mono text-[11px] leading-relaxed custom-scrollbar cancel-drag">
            {logs.map((log) => (
              <div key={log.id} className="mb-2 pb-2 border-b border-white/5 last:border-0 hover:bg-white/5 px-2 py-1 rounded transition-colors group">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white/30 text-[9px] group-hover:text-white/50 transition-colors">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                    log.level === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                    log.level === 'warning' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                    log.level === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                    'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}>
                    {log.level}
                  </span>
                  <span className="text-white/70 font-bold truncate">
                    {log.action}
                  </span>
                </div>
                <div className={`break-words pl-2 border-l-2 ${
                  log.level === 'error' ? 'border-red-500/50 text-red-300' :
                  log.level === 'warning' ? 'border-yellow-500/50 text-yellow-300' :
                  log.level === 'success' ? 'border-green-500/50 text-green-300' :
                  'border-blue-500/50 text-white/60'
                }`}>
                  {log.detail}
                </div>
              </div>
            ))}
          </div>
    </div>
  );

  if (isSecondaryWindow) {
    return content;
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-[100]">
      <DraggableWindow
        defaultPosition={{ 
          x: typeof window !== 'undefined' && window.innerWidth > 400 ? window.innerWidth - 340 : 20, 
          y: 80 
        }}
        defaultSize={{ width: 320, height: 600 }}
        minWidth={250}
        minHeight={300}
        dragHandleClass="logs-drag-handle"
        cancelClass="cancel-drag"
        className="pointer-events-auto"
      >
        {content}
      </DraggableWindow>
    </div>
  );
}
