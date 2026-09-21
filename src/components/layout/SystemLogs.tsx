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
    <div className={`w-full h-full bg-gradient-to-br from-[#FFF5F8] via-[#FFFFFF] to-[#FFF0F5] text-[#1E1926] flex flex-col relative overflow-hidden shadow-2xl ${isSecondaryWindow ? '' : 'rounded-[24px] border border-[#FCE7F3]'}`}>
      
      {/* Header */}
      <div className={`${isSecondaryWindow ? '' : 'logs-drag-handle cursor-move'} shrink-0 p-4 flex items-center justify-between border-b border-[#FCE7F3] bg-white/70 backdrop-blur-sm`}>
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#8B5CF6]" />
              <span className="text-[#1E1926] font-bold text-sm tracking-wide">System Logs</span>
            </div>
            <button onClick={onClose} className="cancel-drag p-1 hover:bg-pink-50 rounded-full text-[#6B7280] hover:text-[#1E1926] transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* System Usage Stats */}
          <div className="p-4 grid grid-cols-3 gap-2 border-b border-[#FCE7F3] bg-white/50 shrink-0 cancel-drag">
            <div className="flex flex-col items-center justify-center p-2 rounded-xl bg-white border border-[#FCE7F3] shadow-xs">
              <Activity className="w-4 h-4 text-[#F43F8E] mb-1" />
              <span className="text-[10px] text-[#9CA3AF] uppercase tracking-widest font-mono">Ping</span>
              <span className="text-xs font-mono font-bold text-[#1E1926]">{latency}</span>
            </div>
            <div className={`flex flex-col items-center justify-center p-2 rounded-xl bg-white border border-[#FCE7F3] shadow-xs ${!isTauri ? 'opacity-50' : ''}`}>
              <Cpu className="w-4 h-4 text-[#3B82F6] mb-1" />
              <span className="text-[10px] text-[#9CA3AF] uppercase tracking-widest font-mono">CPU</span>
              <span className="text-xs font-mono font-bold text-[#1E1926]">{isTauri ? `${cpu}%` : 'N/A'}</span>
            </div>
            <div className={`flex flex-col items-center justify-center p-2 rounded-xl bg-white border border-[#FCE7F3] shadow-xs ${!isTauri ? 'opacity-50' : ''}`}>
              <Server className="w-4 h-4 text-[#10B981] mb-1" />
              <span className="text-[10px] text-[#9CA3AF] uppercase tracking-widest font-mono">RAM</span>
              <span className="text-xs font-mono font-bold text-[#1E1926]">{isTauri ? memory : 'N/A'}</span>
            </div>
          </div>

          {/* Logs Terminal */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 bg-[#FDF8FA] font-mono text-[11px] leading-relaxed custom-scrollbar cancel-drag">
            {logs.map((log) => (
              <div key={log.id} className="mb-2 pb-2 border-b border-[#FCE7F3] last:border-0 hover:bg-white/60 px-2 py-1 rounded transition-colors group">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[#9CA3AF] text-[9px] group-hover:text-[#6B7280] transition-colors">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                    log.level === 'error' ? 'bg-red-100 text-red-600 border border-red-200' :
                    log.level === 'warning' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                    log.level === 'success' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                    'bg-blue-100 text-blue-700 border border-blue-200'
                  }`}>
                    {log.level}
                  </span>
                  <span className="text-[#1E1926] font-bold truncate">
                    {log.action}
                  </span>
                </div>
                <div className={`break-words pl-2 border-l-2 ${
                  log.level === 'error' ? 'border-red-400 text-red-600' :
                  log.level === 'warning' ? 'border-amber-400 text-amber-800' :
                  log.level === 'success' ? 'border-emerald-400 text-emerald-800' :
                  'border-blue-400 text-[#5C5568]'
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
