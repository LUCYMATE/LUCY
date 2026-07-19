import { Settings, CalendarClock, Trash2, Clock, X, MessageSquare } from 'lucide-react';
import { Chat } from '../chat/Chat';
import { useState, useEffect, useRef } from 'react';
import { SettingsPage } from '../settings/SettingsPage';
import { DraggableWindow } from './DraggableWindow';
import { getScheduledTasks, cancelScheduledTaskById, ScheduledTask } from '../../lib/gemini/gemini-live';
import { getSystemStats, isTauriApp } from '../../lib/system/tauriBridge';
import { logger, LogEntry } from '../../lib/store/logger';
import { AvatarController } from '../avatar/AvatarController';
import { SystemIndicators } from './SystemIndicators';
import { SystemLogs } from './SystemLogs';
import { useCoreEngine } from '../../hooks/useCoreEngine';

export function SoltiniOS({ isAuthorized = false }: { isAuthorized?: boolean }) {
  const [showSettings, setShowSettings] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  
  // Start the core engine unconditionally so the avatar stays alive
  useCoreEngine();

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
  const [tasksPos, setTasksPos] = useState<{x: number, y: number} | null>(null);
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
    const handleOpenSettings = () => { setShowSettings(true); setShowTasks(false); setShowChat(false); setShowLogs(false); };
    const handleOpenTasks = (e: any) => {
      setShowTasks(true); setShowSettings(false); setShowChat(false); setShowLogs(false);
      if (e.detail && typeof e.detail.x === 'number') {
        setTasksPos({ x: e.detail.x, y: e.detail.y });
      } else {
        setTasksPos(null);
      }
    };
    const handleOpenChat = () => { setShowChat(true); setShowSettings(false); setShowTasks(false); setShowLogs(false); };
    const handleOpenLogs = () => { setShowLogs(true); setShowSettings(false); setShowTasks(false); setShowChat(false); };
    window.addEventListener('soltini-open-settings', handleOpenSettings);
    window.addEventListener('soltini-open-tasks', handleOpenTasks);
    window.addEventListener('soltini-open-chat', handleOpenChat);
    window.addEventListener('soltini-open-logs', handleOpenLogs);
    return () => {
      window.removeEventListener('soltini-open-settings', handleOpenSettings);
      window.removeEventListener('soltini-open-tasks', handleOpenTasks);
      window.removeEventListener('soltini-open-chat', handleOpenChat);
      window.removeEventListener('soltini-open-logs', handleOpenLogs);
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
      if (showSettings) return;
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
  }, [isTauri, showSettings]);

  return (
    <div className={`flex h-full w-full relative min-h-0 p-0 max-w-none`}>
      
      <SystemIndicators />
      
      {showSettings && (
        <div className="absolute inset-0 pointer-events-none z-50">
          <DraggableWindow
            defaultPosition={{ 
              x: window.innerWidth > 800 ? (window.innerWidth - 800) / 2 : 50,
              y: window.innerHeight > 600 ? (window.innerHeight - 600) / 2 : 50
            }}
            defaultSize={{ width: 800, height: 600 }}
            minWidth={500}
            minHeight={500}
            dragHandleClass="settings-drag-handle"
            cancelClass="cancel-drag"
            className="pointer-events-auto"
          >
            <div className="settings-drag-handle w-full h-full bg-[#181818] rounded-[32px] flex flex-col relative border border-white/20 overflow-hidden">
              <SettingsPage onClose={() => setShowSettings(false)} />
              <button onClick={() => setShowSettings(false)} className="cancel-drag absolute top-4 right-6 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-50 cursor-pointer">
                <X className="w-5 h-5 text-white/90" />
              </button>
            </div>
          </DraggableWindow>
        </div>
      )}
      
      {showTasks && (
        <div 
          className="absolute z-50 w-72 bg-[#121212]/95 backdrop-blur-md rounded-[20px] p-4 border border-white/20 shadow-2xl flex flex-col gap-3 animate-in zoom-in-95 duration-200 pointer-events-auto"
          style={{
            left: tasksPos ? `${Math.min(tasksPos.x + 20, window.innerWidth - 300)}px` : '340px',
            top: tasksPos ? `${Math.min(tasksPos.y - 100, window.innerHeight - 300)}px` : 'auto',
            bottom: tasksPos ? 'auto' : '24px'
          }}
        >
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

      <div className="absolute inset-0 pointer-events-none z-0">
        <Chat 
          isVisible={showChat}
          onCloseChat={() => setShowChat(false)}
        />
        <SystemLogs
          isVisible={showLogs}
          onClose={() => setShowLogs(false)}
          logs={logs}
          cpu={cpu}
          memory={memory}
          latency={latency}
          isTauri={isTauri}
        />
      </div>
      
      <AvatarController />
    </div>
  );
}
