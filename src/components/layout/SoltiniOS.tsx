import { Settings, CalendarClock, Trash2, Clock, X, MessageSquare } from 'lucide-react';
import { Chat } from '../chat/Chat';
import { useState, useEffect, useRef } from 'react';
import { SettingsPage } from '../settings/SettingsPage';
import { DraggableWindow } from './DraggableWindow';
import { getScheduledTasks, cancelScheduledTaskById, ScheduledTask } from '../../lib/gemini/gemini-live';
import { getSystemStats, isTauriApp, trimMemory } from '../../lib/system/tauriBridge';
import { logger, LogEntry } from '../../lib/store/logger';
import { AvatarController } from '../avatar/AvatarController';
import { SystemIndicators } from './SystemIndicators';
import { SystemLogs } from './SystemLogs';
import { useCoreEngine } from '../../hooks/useCoreEngine';

import { useAvatarState } from '../../lib/store/avatarState';
import { useChatStore } from '../../lib/store/chatStore';
import { useEngineStore } from '../../lib/store/engineStore';
import { clearVrmCache } from '../avatar/VrmModel';
import { clearFbxCache } from '../avatar/animations/useFbxAnimation';

export function SoltiniOS({ isAuthorized = false }: { isAuthorized?: boolean }) {
  
  const isSleepMode = useAvatarState(s => s.isSleepMode);

  // Start the core engine unconditionally so the avatar stays alive
  useCoreEngine();

  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [latency, setLatency] = useState<string>('checking...');

  useEffect(() => {
    const loadTasks = () => setTasks(getScheduledTasks());
    loadTasks();
    const handleTasksChanged = () => {
      loadTasks();
      import('@tauri-apps/api/event').then(({ emit }) => emit('soltini-sync-tasks'));
    };
    window.addEventListener('soltini-tasks-changed', handleTasksChanged);
    return () => window.removeEventListener('soltini-tasks-changed', handleTasksChanged);
  }, []);

  // IPC Bridge for Secondary Window
  useEffect(() => {
    let unlistenSend: any, unlistenMic: any;
    
    import('@tauri-apps/api/event').then(({ emit, listen }) => {
      const unsubChat = useChatStore.subscribe(state => emit('soltini-sync-chat', state.messages));
      const unsubAvatar = useAvatarState.subscribe(state => emit('soltini-sync-avatar', { 
        isMicOn: state.isMicOn, 
        connectionState: state.connectionState 
      }));
      const unsubLogs = logger.subscribe(logs => emit('soltini-sync-logs', logs));

      listen('soltini-chat-send', (e: any) => {
        useEngineStore.getState().sendText(e.payload as string);
      }).then(unsub => unlistenSend = unsub);

      listen('soltini-toggle-mic', () => {
        useEngineStore.getState().toggleMic();
      }).then(unsub => unlistenMic = unsub);

      // Force an initial sync when the secondary window asks
      listen('soltini-request-sync', () => {
        emit('soltini-sync-chat', useChatStore.getState().messages);
        emit('soltini-sync-avatar', { 
          isMicOn: useAvatarState.getState().isMicOn, 
          connectionState: useAvatarState.getState().connectionState 
        });
        emit('soltini-sync-logs', logger.getLogs()); // we need to ensure logger.getLogs() exists
        emit('soltini-sync-tasks');
      });

      // Cleanup subscription
      (window as any)._ipcUnsub = () => {
        unsubChat(); unsubAvatar(); unsubLogs();
        if (unlistenSend) unlistenSend();
        if (unlistenMic) unlistenMic();
      };
    });

    return () => {
      if ((window as any)._ipcUnsub) (window as any)._ipcUnsub();
    };
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isSleepMode) {
      clearVrmCache();
      clearFbxCache();
      setTimeout(() => trimMemory(), 500);
      // Periodic trim to keep the SpeechRecognition wake-word listener's
      // native memory leak bounded — Chromium's Web Speech API doesn't fully
      // release resources, so RAM creeps up over time without this.
      interval = setInterval(() => {
        trimMemory();
      }, 300000);
    } else {
      // Aggressively keep RAM footprint low (~300MB) during normal active use
      // Delay the first trim by 10s to ensure the heavy VRM model finishes loading safely first!
      setTimeout(() => trimMemory(), 10000);
      interval = setInterval(() => {
        trimMemory();
      }, 300000); // 5 minutes — frequent enough to keep RAM bounded, infrequent enough to avoid paging thrashing
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSleepMode]);
  
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
    const openTab = async (tab: string) => {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const existing = await WebviewWindow.getByLabel('settings');
        if (existing) {
          existing.setFocus();
          import('@tauri-apps/api/event').then(({ emit }) => emit('soltini-switch-tab', tab));
          return;
        }
        new WebviewWindow('settings', {
          url: `index.html#settings?tab=${tab}`,
          title: 'Soltini Dashboard',
          width: 900,
          height: 600,
          x: 200,
          y: 200,
          resizable: true
        });
      } catch (e) {
        console.warn('Failed to open settings window', e);
      }
    };

    const handleOpenSettings = () => openTab('settings');
    const handleOpenTasks = () => openTab('tasks');
    const handleOpenChat = () => openTab('dashboard');
    const handleOpenLogs = () => openTab('dashboard');
    
    const handleSleep = () => {
      import('@tauri-apps/api/webviewWindow').then(({ WebviewWindow }) => {
        WebviewWindow.getByLabel('settings').then(w => w?.close());
      });
    };

    const handleWakeUp = () => {
      useAvatarState.getState().setIsSleepMode(false);
    };

    const handleToggleSleep = () => {
      const isSleep = useAvatarState.getState().isSleepMode;
      if (isSleep) {
        window.dispatchEvent(new CustomEvent('soltini-wake-up'));
      } else {
        window.dispatchEvent(new CustomEvent('soltini-sleep'));
      }
    };

    window.addEventListener('soltini-toggle-sleep', handleToggleSleep);
    window.addEventListener('soltini-open-settings', handleOpenSettings);
    window.addEventListener('soltini-open-tasks', handleOpenTasks);
    window.addEventListener('soltini-open-chat', handleOpenChat);
    window.addEventListener('soltini-open-logs', handleOpenLogs);
    window.addEventListener('soltini-sleep', handleSleep);
    window.addEventListener('soltini-wake-up', handleWakeUp);
    return () => {
      window.removeEventListener('soltini-toggle-sleep', handleToggleSleep);
      window.removeEventListener('soltini-open-settings', handleOpenSettings);
      window.removeEventListener('soltini-open-tasks', handleOpenTasks);
      window.removeEventListener('soltini-open-chat', handleOpenChat);
      window.removeEventListener('soltini-open-logs', handleOpenLogs);
      window.removeEventListener('soltini-sleep', handleSleep);
      window.removeEventListener('soltini-wake-up', handleWakeUp);
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
      if (!isTauri) return; // Fetch system stats continuously so it's ready if logs window opens
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
      if (isSleepMode) return;
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
  }, [isTauri, isSleepMode]);

  return (
    <div className={`flex h-full w-full relative min-h-0 p-0 max-w-none`}>
      
      {!isSleepMode && <SystemIndicators />}
      
      {!isSleepMode && <AvatarController />}
    </div>
  );
}
