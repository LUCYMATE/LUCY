import { Settings, CalendarClock, Trash2, Clock, X } from 'lucide-react';
import { Chat } from '../chat/Chat';
import { useState, useEffect, useRef } from 'react';
import { SettingsPage } from '../settings/SettingsPage';
import { getScheduledTasks, cancelScheduledTaskById, ScheduledTask } from '../../lib/gemini/gemini-live';
import { getSystemStats, isTauriApp } from '../../lib/system/tauriBridge';
import { logger, LogEntry } from '../../lib/store/logger';
import { AvatarController } from '../avatar/AvatarController';


export function SoltiniOS({ isPetMode = false }: { isPetMode?: boolean }) {
  const [showSettings, setShowSettings] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [latency, setLatency] = useState<string>('checking...');

  useEffect(() => {
    const loadTasks = () => setTasks(getScheduledTasks());
    loadTasks();
    window.addEventListener('soltini-tasks-changed', loadTasks);
    return () => window.removeEventListener('soltini-tasks-changed', loadTasks);
  }, []);
  const [cpu, setCpu] = useState<number>(0);
  const [memory, setMemory] = useState<string>('0 / 0 GB');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const isTauri = isTauriApp();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Always scroll to the newest log, with a tiny delay to ensure DOM is updated
    setTimeout(() => {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }, [logs]);

  useEffect(() => {
    if (isPetMode) {
      setShowSettings(false);
      setShowTasks(false);
    }
  }, [isPetMode]);

  useEffect(() => {
    const handleOpenSettings = () => { setShowSettings(true); setShowTasks(false); };
    const handleOpenTasks = () => { setShowTasks(true); setShowSettings(false); };
    window.addEventListener('soltini-open-settings', handleOpenSettings);
    window.addEventListener('soltini-open-tasks', handleOpenTasks);
    return () => {
      window.removeEventListener('soltini-open-settings', handleOpenSettings);
      window.removeEventListener('soltini-open-tasks', handleOpenTasks);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = logger.subscribe(setLogs);
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const checkPing = async () => {
      try {
        const start = performance.now();
        await fetch('/index.html?t=' + start, { method: 'HEAD' });
        const rtt = Math.round(performance.now() - start);
        setLatency(`${rtt}ms`);
      } catch (e) {
        setLatency('Offline');
      }
    };

    const checkStats = async () => {
      if (!isTauri) return;
      try {
        const stats = await getSystemStats();
        if (stats) {
          setCpu(Math.round(stats.cpu_usage));
          const appMB = (stats.app_memory / (1024 * 1024)).toFixed(0);
          setMemory(`${appMB} MB`);
        }
      } catch (e) {
        console.warn('Failed to fetch system stats:', e);
      }
    };

    // Only run stats when sidebar is visible (not in pet mode or when settings is closed)
    const startPolling = () => {
      if (isPetMode || showSettings) return;
      checkPing();
      checkStats();
      interval = setInterval(() => {
        checkPing();
        checkStats();
      }, 15000);
    };

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    startPolling();

    return () => stopPolling();
  }, [isTauri, isPetMode, showSettings]);

  return (
    <div className={`flex h-full w-full relative min-h-0 ${isPetMode ? 'p-0 max-w-none' : 'px-2 py-1 sm:px-3 gap-2 sm:gap-3'}`}>
      <div className={`flex-1 w-full h-full glass rounded-[20px] ${showSettings ? 'block' : 'hidden'}`}>
        {showSettings && <SettingsPage onClose={() => setShowSettings(false)} />}
      </div>
      
      {showTasks && (
        <div className="absolute left-16 sm:left-[340px] bottom-6 z-50 w-72 glass rounded-[20px] p-4 border border-white/20 shadow-2xl flex flex-col gap-3 animate-in slide-in-from-bottom-4 fade-in pointer-events-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-pink-400" />
              <h3 className="text-sm font-bold text-white">Scheduled Tasks</h3>
            </div>
            <button onClick={() => setShowTasks(false)} className="hover:bg-white/10 p-1 rounded-full"><X className="w-4 h-4 text-white/70" /></button>
          </div>
          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
            {tasks.length === 0 ? (
              <p className="text-xs text-white/50 text-center py-4">No tasks scheduled.</p>
            ) : (
              tasks.map(t => (
                <div key={t.id} className="bg-white/5 border border-white/10 rounded-xl p-2 flex flex-col gap-1 relative group">
                  <p className="text-xs text-white/90 line-clamp-2 pr-6">{t.instruction}</p>
                  <p className="text-[10px] text-pink-300/80 font-mono flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(t.targetTimeMs).toLocaleTimeString()}</p>
                  <button onClick={() => cancelScheduledTaskById(t.id)} className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded-md text-red-400 transition-all"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className={`flex h-full w-full gap-2 sm:gap-3 ${showSettings ? 'hidden' : 'flex'}`}>
        {/* Main Workspace */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 h-full">
          <section className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className={`${!isPetMode ? 'glass rounded-[20px] shadow-2xl' : ''} flex-1 relative overflow-hidden flex flex-col min-h-0`}>
              <Chat isPetMode={isPetMode} />
            </div>
          </section>
        </main>

          {/* Navigation */}
          {!isPetMode && (
            <aside className="w-16 sm:w-80 shrink-0 flex flex-col">
              <div className="flex flex-col items-center sm:items-start glass rounded-[20px] shadow-2xl p-4 sm:p-6 h-full gap-8 relative z-10">
               <div className="flex items-center gap-3 w-full justify-center sm:justify-start shrink-0">
                 <img src="/logo.png" alt="Soltini Logo" className="w-8 h-8 rounded-full object-cover shadow-[0_0_15px_rgba(236,72,153,0.5)] shrink-0" />
                 <h1 className="text-xl font-bold tracking-tight text-white hidden sm:block">SOLTINI</h1>
               </div>
               
               {/* Activity Logs (only visible on desktop) */}
               <div className="hidden sm:flex flex-1 overflow-hidden flex-col w-full bg-black/20 rounded-xl border border-white/5 min-h-0">
                 <div className="p-3 border-b border-white/5 bg-white/5 flex items-center justify-between shrink-0">
                   <span className="text-[10px] uppercase tracking-widest text-pink-300 font-medium">Activity Log</span>
                   <span className="flex h-2 w-2 relative">
                     <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                     <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500"></span>
                   </span>
                 </div>
                 <div ref={logsContainerRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 relative">
                   {(() => {
                     const displayLogs = logs.filter(log => log.level === 'error' || log.level === 'warning' || (log.level === 'success' && !log.action.includes('Tool')));
                     return displayLogs.length === 0 ? (
                       <div className="text-white/30 text-xs italic text-center mt-4">Waiting for activity...</div>
                     ) : (
                       displayLogs.map(log => (
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
                     );
                   })()}
                   {/* Auto-scroll anchor */}
                   <div className="h-1 shrink-0" ref={logsEndRef} />
                 </div>
               </div>
               
               <div className="flex flex-col gap-6 w-full mt-auto shrink-0">
                  <div className="hidden sm:flex flex-col gap-4 bg-white/5 border border-white/10 rounded-xl p-4 text-left">
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
                          <p className="text-[10px] uppercase tracking-widest text-pink-300 opacity-60 mb-0.5">App RAM Usage</p>
                          <p className="text-sm font-mono text-white">{memory}</p>
                        </div>
                      </>
                    )}
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-0 w-full sm:h-12 sm:bg-white/5 sm:border sm:border-white/10 rounded-xl overflow-hidden mt-2">
                    <div className="w-12 h-12 sm:w-1/2 sm:h-full rounded-xl sm:rounded-none bg-white/5 sm:bg-transparent border border-white/10 sm:border-none flex items-center justify-center cursor-pointer hover:bg-white/10 transition-colors gap-2" onClick={() => { setShowTasks(true); setShowSettings(false); }} title="Tasks">
                      <CalendarClock className="w-5 h-5 text-white" />
                      <span className="hidden sm:block text-white font-medium text-sm">Tasks</span>
                    </div>
                    <div className="hidden sm:block w-px h-full bg-white/10" />
                    <div className="w-12 h-12 sm:w-1/2 sm:h-full rounded-xl sm:rounded-none bg-white/5 sm:bg-transparent border border-white/10 sm:border-none flex items-center justify-center cursor-pointer hover:bg-white/10 transition-colors gap-2" onClick={() => { setShowSettings(true); setShowTasks(false); }} title="Settings">
                      <Settings className="w-5 h-5 text-white" />
                      <span className="hidden sm:block text-white font-medium text-sm">Settings</span>
                    </div>
                  </div>
                 </div>
              </div>
            </aside>
          )}
          
          {/* AvatarController mounts the 3D scene. Unmounting it saves all RAM/CPU! */}
          <AvatarController isPetMode={isPetMode} />
      </div>
    </div>
  );
}
