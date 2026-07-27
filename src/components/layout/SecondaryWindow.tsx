import { useEffect, useState } from 'react';
import { SettingsPage } from '../settings/SettingsPage';
import { Chat } from '../chat/Chat';
import { SystemLogs } from './SystemLogs';
import { CalendarClock, Trash2, Clock, X } from 'lucide-react';
import { getScheduledTasks, cancelScheduledTaskById, ScheduledTask } from '../../lib/gemini/gemini-live';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useChatStore } from '../../lib/store/chatStore';
import { useAvatarState } from '../../lib/store/avatarState';
import { LogEntry } from '../../lib/store/logger';

export function SecondaryWindow() {
  const [activeTab, setActiveTab] = useState<'settings' | 'dashboard' | 'tasks'>('settings');

  // Handle Hash routing from URL to select the right tab initially
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('tab=dashboard')) setActiveTab('dashboard');
    else if (hash.includes('tab=tasks')) setActiveTab('tasks');
    else setActiveTab('settings');

    const handleSwitchTab = (e: any) => {
      if (e.payload) {
        setActiveTab(e.payload as any);
      }
    };

    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('soltini-switch-tab', handleSwitchTab);
    });

  }, []);

  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Handle IPC from Main Window
  useEffect(() => {
    let unlisteners: any[] = [];
    
    import('@tauri-apps/api/event').then(({ listen, emit }) => {
      listen('soltini-sync-chat', (e: any) => useChatStore.getState().setMessages(e.payload)).then(u => unlisteners.push(u));
      listen('soltini-sync-avatar', (e: any) => {
        useAvatarState.getState().setIsMicOn(e.payload.isMicOn);
        useAvatarState.getState().setConnectionState(e.payload.connectionState);
      }).then(u => unlisteners.push(u));
      listen('soltini-sync-logs', (e: any) => setLogs(e.payload)).then(u => unlisteners.push(u));
      
      // Request initial sync
      emit('soltini-request-sync');
    });

    return () => unlisteners.forEach(u => u && u());
  }, []);

  const closeSelf = () => getCurrentWebviewWindow().close();

  return (
    <div className="h-screen w-screen bg-[#0d1128] text-white flex flex-col font-sans">
      <div className="flex items-center justify-between bg-black/40 border-b border-white/10 p-2 draggable">
        <div className="flex gap-2 pl-2">
          <button onClick={() => setActiveTab('settings')} className={`px-4 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${activeTab === 'settings' ? 'bg-indigo-500/20 text-indigo-300' : 'hover:bg-white/5 text-white/70'}`}>Settings</button>
          <button onClick={() => setActiveTab('dashboard')} className={`px-4 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${activeTab === 'dashboard' ? 'bg-pink-500/20 text-pink-300' : 'hover:bg-white/5 text-white/70'}`}>Dashboard</button>
          <button onClick={() => setActiveTab('tasks')} className={`px-4 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${activeTab === 'tasks' ? 'bg-blue-500/20 text-blue-300' : 'hover:bg-white/5 text-white/70'}`}>Tasks</button>
        </div>
      </div>
      <div className="flex-1 relative overflow-hidden flex">
        {activeTab === 'settings' && <div className="w-full h-full relative"><SettingsPage onClose={() => {}} /></div>}
        {activeTab === 'dashboard' && (
          <div className="flex w-full h-full">
            <div className="flex-1 h-full relative">
              <Chat isVisible={true} onCloseChat={() => {}} isSecondaryWindow={true} />
            </div>
            <div className="w-[360px] h-full border-l border-white/10 relative">
              <SystemLogs
                isVisible={true}
                onClose={() => {}}
                logs={logs}
                cpu={0}
                memory={'N/A'}
                latency={'N/A'}
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
    const interval = setInterval(loadTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full h-full bg-[#121212] p-6 overflow-y-auto custom-scrollbar">
      <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
        <CalendarClock className="w-6 h-6 text-pink-400" />
        <h2 className="text-xl font-bold text-white">Scheduled Tasks</h2>
      </div>
      <div className="flex flex-col gap-3">
        {tasks.length === 0 ? (
          <p className="text-sm text-white/50 py-4">No tasks scheduled.</p>
        ) : (
          tasks.map(t => (
            <div key={t.id} className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-2 relative group hover:bg-white/10 transition-colors">
              <p className="text-sm text-white/90 pr-8">{t.instruction}</p>
              <p className="text-xs text-pink-300/80 font-mono flex items-center gap-1">
                <Clock className="w-3 h-3" /> {new Date(t.targetTimeMs).toLocaleTimeString()}
              </p>
              <button 
                onClick={() => { cancelScheduledTaskById(t.id); setTasks(getScheduledTasks()); }} 
                className="absolute right-4 top-4 p-2 hover:bg-red-500/20 rounded-md text-red-400 transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
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
