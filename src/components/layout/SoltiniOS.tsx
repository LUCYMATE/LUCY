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
import { emitCrossWindow, listenCrossWindow } from '../../lib/events/crossWindowEventBus';

export function SoltiniOS({ isAuthorized = false }: { isAuthorized?: boolean }) {
  
  const isSleepMode = useAvatarState(s => s.isSleepMode);

  // Start the core engine unconditionally so the avatar stays alive
  useCoreEngine();

  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [latency, setLatency] = useState<string>('checking...');
  const [cpu, setCpu] = useState<number>(0);
  const [memory, setMemory] = useState<string>('0 / 0 GB');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const isTauri = isTauriApp();

  useEffect(() => {
    const loadTasks = () => setTasks(getScheduledTasks());
    loadTasks();
    const unsub = listenCrossWindow('soltini-tasks-changed', () => {
      loadTasks();
      emitCrossWindow('soltini-sync-tasks', getScheduledTasks());
    });
    return () => unsub();
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
        emit('soltini-sync-logs', logger.getLogs());
        emit('soltini-sync-tasks', getScheduledTasks());
        emit('soltini-sync-stats', { cpu, memory, latency });
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
  }, [cpu, memory, latency]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isSleepMode) {
      clearVrmCache();
      clearFbxCache();
      setTimeout(() => trimMemory(), 500);
      interval = setInterval(() => {
        trimMemory();
      }, 300000);
    } else {
      setTimeout(() => trimMemory(), 10000);
      interval = setInterval(() => {
        trimMemory();
      }, 300000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSleepMode]);

  useEffect(() => {
    const openTab = async (tab: string) => {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const existing = await WebviewWindow.getByLabel('settings');
        if (existing) {
          await existing.unminimize().catch(() => {});
          await existing.show().catch(() => {});
          await existing.setFocus().catch(() => {});
          await emitCrossWindow('soltini-switch-tab', tab);
          return;
        }
        const win = new WebviewWindow('settings', {
          url: `index.html#settings?tab=${tab}`,
          title: 'LUCY Dashboard',
          width: 900,
          height: 600,
          x: 200,
          y: 200,
          resizable: true
        });
        win.once('tauri://error', (e) => {
          console.warn('Failed to open settings window:', e);
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
        emitCrossWindow('soltini-wake-up');
      } else {
        emitCrossWindow('soltini-sleep');
      }
    };

    const unsubs = [
      listenCrossWindow('soltini-toggle-sleep', handleToggleSleep),
      listenCrossWindow('soltini-open-settings', handleOpenSettings),
      listenCrossWindow('soltini-open-tasks', handleOpenTasks),
      listenCrossWindow('soltini-open-chat', handleOpenChat),
      listenCrossWindow('soltini-open-logs', handleOpenLogs),
      listenCrossWindow('soltini-sleep', handleSleep),
      listenCrossWindow('soltini-wake-up', handleWakeUp)
    ];

    return () => {
      unsubs.forEach(u => u());
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
        const newLat = `${rtt}ms`;
        setLatency(newLat);
        return newLat;
      } catch (e) {
        setLatency('Offline');
        return 'Offline';
      }
    };

    const checkStats = async () => {
      const currentPing = await checkPing();
      if (!isTauri) return;
      try {
        const stats = await getSystemStats();
        if (stats) {
          const newCpu = Math.round(stats.cpu_usage);
          const appMB = (stats.app_memory / (1024 * 1024)).toFixed(0);
          const newMem = `${appMB} MB`;
          setCpu(newCpu);
          setMemory(newMem);
          emitCrossWindow('soltini-sync-stats', {
            cpu: newCpu,
            memory: newMem,
            latency: currentPing
          });
        }
      } catch (e) {
        console.warn('Failed to fetch system stats:', e);
      }
    };

    const startPolling = () => {
      if (isSleepMode) return;
      checkStats();
      interval = setInterval(() => {
        checkStats();
      }, 10000);
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
    <div className="flex h-full w-full relative min-h-0 p-0 max-w-none">
      {!isSleepMode && <SystemIndicators />}
      {!isSleepMode && <AvatarController />}
    </div>
  );
}
