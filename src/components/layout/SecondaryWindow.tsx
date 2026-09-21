import { useEffect, useState } from 'react';
import { SettingsPage } from '../settings/SettingsPage';
import { Chat } from '../chat/Chat';
import { SystemLogs } from './SystemLogs';
import { CalendarClock, Trash2, Clock, X, Sliders, LayoutDashboard, ListTodo } from 'lucide-react';
import { getScheduledTasks, cancelScheduledTaskById, ScheduledTask } from '../../lib/gemini/gemini-live';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useChatStore } from '../../lib/store/chatStore';
import { useAvatarState } from '../../lib/store/avatarState';
import { LogEntry } from '../../lib/store/logger';
import { listenCrossWindow, emitCrossWindow } from '../../lib/events/crossWindowEventBus';

export function SecondaryWindow() {
  const [activeTab, setActiveTab] = useState<'settings' | 'dashboard' | 'tasks'>('settings');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<{ cpu: number | string; memory: string; latency: string }>({
    cpu: 0,
    memory: '0 MB',
    latency: 'checking...'
  });

  // Handle Hash routing from URL to select the right tab initially
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash.includes('tab=dashboard')) setActiveTab('dashboard');
      else if (hash.includes('tab=tasks')) setActiveTab('tasks');
      else setActiveTab('settings');
    };
    handleHash();

    const unsubTab = listenCrossWindow<string>('soltini-switch-tab', (tab) => {
      if (tab && ['settings', 'dashboard', 'tasks'].includes(tab)) {
        setActiveTab(tab as any);
      }
    });

    return () => unsubTab();
  }, []);

  // Handle IPC from Main Window
  useEffect(() => {
    let unlisteners: (() => void)[] = [];
    
    import('@tauri-apps/api/event').then(({ listen, emit }) => {
      listen('soltini-sync-chat', (e: any) => {
        if (e.payload) useChatStore.getState().setMessages(e.payload);
      }).then(u => unlisteners.push(u));

      listen('soltini-sync-avatar', (e: any) => {
        if (e.payload) {
          useAvatarState.getState().setIsMicOn(e.payload.isMicOn);
          useAvatarState.getState().setConnectionState(e.payload.connectionState);
        }
      }).then(u => unlisteners.push(u));

      listen('soltini-sync-logs', (e: any) => {
        if (e.payload) setLogs(e.payload);
      }).then(u => unlisteners.push(u));

      listen('soltini-sync-stats', (e: any) => {
        if (e.payload) {
          setStats({
            cpu: e.payload.cpu ?? 0,
            memory: e.payload.memory ?? '0 MB',
            latency: e.payload.latency ?? 'Offline'
          });
        }
      }).then(u => unlisteners.push(u));
      
      // Request initial sync from main window
      emit('soltini-request-sync');
    });

    return () => unlisteners.forEach(u => u && u());
  }, []);

  const closeSelf = () => {
    try {
      getCurrentWebviewWindow().close();
    } catch (e) {
      window.close();
    }
  };

  return (
    <div className="h-screen w-screen bg-[#FFF5F8] text-[#1E1926] flex flex-col font-sans select-none overflow-hidden">
      {/* Title bar with drag region */}
      <div 
        data-tauri-drag-region 
        className="flex items-center justify-between bg-white/80 backdrop-blur-sm border-b border-[#FCE7F3] px-3 py-2 shrink-0 cursor-move"
      >
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setActiveTab('settings')} 
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'settings' 
                ? 'bg-[#FDF2F8] text-[#F43F8E] border border-[#FCE7F3] shadow-xs' 
                : 'hover:bg-pink-50 text-[#6B7280] hover:text-[#1E1926]'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" /> Settings
          </button>
          <button 
            onClick={() => setActiveTab('dashboard')} 
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'dashboard' 
                ? 'bg-[#FDF2F8] text-[#F43F8E] border border-[#FCE7F3] shadow-xs' 
                : 'hover:bg-pink-50 text-[#6B7280] hover:text-[#1E1926]'
            }`}
          >
            <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('tasks')} 
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'tasks' 
                ? 'bg-[#FDF2F8] text-[#F43F8E] border border-[#FCE7F3] shadow-xs' 
                : 'hover:bg-pink-50 text-[#6B7280] hover:text-[#1E1926]'
            }`}
          >
            <ListTodo className="w-3.5 h-3.5" /> Tasks
          </button>
        </div>

        {/* Window Close Button */}
        <div className="flex items-center">
          <button 
            onClick={closeSelf} 
            className="p-1.5 hover:bg-red-50 text-[#9CA3AF] hover:text-red-500 rounded-lg transition-colors cursor-pointer"
            title="Close Window"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Tab Content Area */}
      <div className="flex-1 relative overflow-hidden flex select-text">
        {activeTab === 'settings' && (
          <div className="w-full h-full relative overflow-y-auto">
            <SettingsPage onClose={closeSelf} />
          </div>
        )}
        {activeTab === 'dashboard' && (
          <div className="flex w-full h-full">
            <div className="flex-1 h-full relative min-w-0">
              <Chat isVisible={true} onCloseChat={closeSelf} isSecondaryWindow={true} />
            </div>
            <div className="w-[360px] h-full border-l border-[#FCE7F3] relative shrink-0">
              <SystemLogs
                isVisible={true}
                onClose={closeSelf}
                logs={logs}
                cpu={stats.cpu}
                memory={stats.memory}
                latency={stats.latency}
                isTauri={true}
                isSecondaryWindow={true}
              />
            </div>
          </div>
        )}
        {activeTab === 'tasks' && <TasksPanel />}
      </div>
    </div>
  );
}

function TasksPanel() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);

  useEffect(() => {
    const loadTasks = () => setTasks(getScheduledTasks());
    loadTasks();
    const unsub = listenCrossWindow('soltini-tasks-changed', loadTasks);
    const interval = setInterval(loadTasks, 4000);
    return () => {
      unsub();
      clearInterval(interval);
    };
  }, []);

  const handleCancelTask = (id: string) => {
    cancelScheduledTaskById(id);
    emitCrossWindow('soltini-cancel-task', id);
    setTasks(getScheduledTasks());
  };

  return (
    <div className="w-full h-full bg-gradient-to-br from-[#FFF5F8] via-[#FFFFFF] to-[#FFF0F5] p-6 overflow-y-auto custom-scrollbar text-[#1E1926]">
      <div className="flex items-center gap-3 mb-6 border-b border-[#FCE7F3] pb-4">
        <CalendarClock className="w-6 h-6 text-[#F43F8E]" />
        <h2 className="text-xl font-bold text-[#1E1926]">Scheduled Tasks</h2>
      </div>
      <div className="flex flex-col gap-3">
        {tasks.length === 0 ? (
          <p className="text-sm text-[#9CA3AF] py-4">No tasks scheduled.</p>
        ) : (
          tasks.map(t => (
            <div key={t.id} className="bg-white border border-[#FCE7F3] rounded-2xl p-4 shadow-xs flex flex-col gap-2 relative group hover:border-[#F472B6] transition-colors">
              <p className="text-sm font-semibold text-[#1E1926] pr-8">{t.instruction}</p>
              <p className="text-xs text-[#8B5CF6] font-mono flex items-center gap-1">
                <Clock className="w-3 h-3" /> {new Date(t.targetTimeMs).toLocaleTimeString()}
              </p>
              <button 
                onClick={() => handleCancelTask(t.id)} 
                className="absolute right-4 top-4 p-2 hover:bg-red-50 rounded-lg text-[#9CA3AF] hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
                title="Cancel Task"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
