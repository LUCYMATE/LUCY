import { Settings } from 'lucide-react';
import { Chat } from '../chat/Chat';
import { useState, useEffect, useRef } from 'react';
import { SettingsModal } from '../settings/SettingsModal';
import { getSystemStats, isTauriApp } from '../../lib/system/tauriBridge';
import { logger, LogEntry } from '../../lib/store/logger';
import { AvatarController } from '../avatar/AvatarController';


export function MyraOS({ isMiniMode = false, isPetMode = false }: { isMiniMode?: boolean, isPetMode?: boolean }) {
  const [showSettings, setShowSettings] = useState(false);
  const [latency, setLatency] = useState<string>('checking...');
  const [cpu, setCpu] = useState<number>(0);
  const [memory, setMemory] = useState<string>('0 / 0 GB');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const isTauri = isTauriApp();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = logsContainerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom || logs.length <= 1) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    const unsubscribe = logger.subscribe(setLogs);
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    // 1. Latency Ping checks
    const checkPing = async () => {
      try {
        const start = performance.now();
        // Fetch current origin with a cache-busting query parameter
        await fetch('/index.html?t=' + start, { method: 'HEAD' });
        const rtt = Math.round(performance.now() - start);
        setLatency(`${rtt}ms`);
      } catch (e) {
        setLatency('Offline');
      }
    };

    // 2. Tauri Stats checks
    const checkStats = async () => {
      if (!isTauri) return;
      try {
        const stats = await getSystemStats();
        if (stats) {
          setCpu(Math.round(stats.cpu_usage));
          const totalGB = (stats.total_memory / (1024 * 1024 * 1024)).toFixed(1);
          const usedGB = (stats.used_memory / (1024 * 1024 * 1024)).toFixed(1);
          setMemory(`${usedGB} / ${totalGB} GB`);
        }
      } catch (e) {
        console.warn('Failed to fetch system stats:', e);
      }
    };

    // Run immediately, then on interval
    checkPing();
    checkStats();

    const interval = setInterval(() => {
      checkPing();
      checkStats();
    }, 3000);

    return () => clearInterval(interval);
  }, [isTauri]);

  return (
    <div 
      className={`flex h-full w-full gap-4 sm:gap-6 relative max-w-[1600px] mx-auto min-h-0 ${isMiniMode || isPetMode ? 'p-0' : 'p-4 sm:p-6'} ${isPetMode ? 'max-w-none' : ''}`}
      data-tauri-drag-region={isMiniMode ? true : undefined}
    >
      {/* Main Workspace */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 h-full">
        <section className="flex-1 flex flex-col min-w-0 min-h-0">
          <div 
            className={`${!isPetMode ? 'glass rounded-[40px]' : ''} flex-1 relative overflow-hidden flex flex-col min-h-0 ${isMiniMode ? '!rounded-xl' : ''}`}
            data-tauri-drag-region={isMiniMode ? true : undefined}
          >
            <Chat isMiniMode={isMiniMode} isPetMode={isPetMode} />
          </div>
        </section>
      </main>

      {/* Navigation (originally on left, now shifted to right) */}
      {!isMiniMode && !isPetMode && (
        <aside className="w-16 sm:w-64 shrink-0 flex flex-col gap-4">
          <div className="flex flex-col items-center sm:items-start glass rounded-3xl p-4 sm:p-6 h-full gap-8">
           <div className="flex items-center gap-3 w-full justify-center sm:justify-start shrink-0">
             <div className="w-3 h-3 rounded-full bg-pink-500 ai-glow shrink-0"></div>
             <h1 className="text-xl font-bold tracking-tight text-white hidden sm:block">MYRA</h1>
           </div>
           
           {/* Activity Logs (only visible on desktop) */}
           <div className="hidden sm:flex flex-1 overflow-hidden flex-col w-full bg-black/20 rounded-2xl border border-white/5 min-h-0">
             <div className="p-3 border-b border-white/5 bg-white/5 flex items-center justify-between shrink-0">
               <span className="text-[10px] uppercase tracking-widest text-pink-300 font-medium">Activity Log</span>
               <span className="flex h-2 w-2 relative">
                 <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                 <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500"></span>
               </span>
             </div>
             <div ref={logsContainerRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 relative">
               {logs.length === 0 ? (
                 <div className="text-white/30 text-xs italic text-center mt-4">Waiting for activity...</div>
               ) : (
                 logs.map(log => (
                   <div key={log.id} className="flex flex-col gap-1 text-xs border-l-2 pl-2 py-1 border-white/10 hover:bg-white/5 transition-colors animate-in slide-in-from-left-2 fade-in duration-300">
                     <div className="flex items-center gap-1.5 opacity-70">
                       <span className="font-mono text-[9px]">{new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}</span>
                       <span className={`text-[10px] font-bold uppercase tracking-wider
                         ${log.level === 'error' ? 'text-red-400' :
                           log.level === 'warning' ? 'text-yellow-400' :
                           log.level === 'success' ? 'text-green-400' : 'text-blue-400'}`
                       }>{log.level}</span>
                     </div>
                     <div className="font-medium text-white/90">{log.action}</div>
                     <div className="text-white/60 text-[10px] leading-tight break-words">{log.detail}</div>
                   </div>
                 ))
               )}
               {/* Auto-scroll anchor */}
               <div className="h-1 shrink-0" ref={logsEndRef} />
             </div>
           </div>
           
           <div className="flex flex-col gap-6 w-full mt-auto shrink-0">
              <div className="hidden sm:flex flex-col gap-4 bg-white/5 border border-white/10 rounded-2xl p-4 text-left">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-pink-300 opacity-60 mb-0.5">Network Latency</p>
                  <p className="text-sm font-mono text-white">{latency}</p>
                </div>
                {isTauri && (
                  <>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <p className="text-[10px] uppercase tracking-widest text-pink-300 opacity-60">CPU Usage</p>
                        <span className="text-xs font-mono text-white">{cpu}%</span>
                      </div>
                      <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-pink-500 h-full rounded-full transition-all duration-500" style={{ width: `${cpu}%` }} />
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-pink-300 opacity-60 mb-0.5">Memory Usage</p>
                      <p className="text-sm font-mono text-white">{memory}</p>
                    </div>
                  </>
                )}
              </div>
              
              <div className="w-12 h-12 sm:w-full sm:h-12 rounded-2xl glass flex items-center justify-center cursor-pointer hover:bg-white/10 transition-colors gap-2" onClick={() => setShowSettings(true)} title="Settings">
                <Settings className="w-5 h-5 text-white" />
                <span className="hidden sm:block text-white font-medium text-sm">Settings</span>
              </div>
             </div>
          </div>
        </aside>
      )}
      
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      <AvatarController isMiniMode={isMiniMode} isPetMode={isPetMode} />
    </div>
  );
}
