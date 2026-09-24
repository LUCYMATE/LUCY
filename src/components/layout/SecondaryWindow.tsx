import { useEffect, useState } from 'react';
import { SettingsPage } from '../settings/SettingsPage';
import { Chat } from '../chat/Chat';
import { SystemLogs } from './SystemLogs';
import { CalendarClock, Trash2, Clock, X, Sliders, LayoutDashboard, ListTodo, Minus, Square, Copy, Terminal } from 'lucide-react';
import { getScheduledTasks, cancelScheduledTaskById, ScheduledTask } from '../../lib/gemini/gemini-live';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useChatStore } from '../../lib/store/chatStore';
import { useAvatarState } from '../../lib/store/avatarState';
import { LogEntry } from '../../lib/store/logger';
import { listenCrossWindow, emitCrossWindow } from '../../lib/events/crossWindowEventBus';

export function SecondaryWindow() {
  const [activeTab, setActiveTab] = useState<'settings' | 'dashboard' | 'tasks'>('dashboard');
  const [showLogs, setShowLogs] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<{ cpu: number | string; memory: string; latency: string }>({
    cpu: 0,
    memory: '0 MB',
    latency: 'checking...'
  });

  // Track window maximize state
  useEffect(() => {
    let unlistenResize: (() => void) | undefined;
    try {
      const win = getCurrentWebviewWindow();
      win.isMaximized().then(setIsMaximized).catch(() => {});
      win.onResized(() => {
        win.isMaximized().then(setIsMaximized).catch(() => {});
      }).then(u => { unlistenResize = u; }).catch(() => {});
    } catch (_) {}
    return () => {
      if (unlistenResize) unlistenResize();
    };
  }, []);

  // Handle Hash routing from URL to select the right tab initially
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash.includes('tab=dashboard')) {
        setActiveTab('dashboard');
      } else if (hash.includes('tab=logs')) {
        setActiveTab('dashboard');
        setShowLogs(true);
      } else if (hash.includes('tab=tasks')) {
        setActiveTab('tasks');
      } else {
        setActiveTab('settings');
      }
    };
    handleHash();

    const unsubTab = listenCrossWindow<string>('lucy-switch-tab', (tab) => {
      if (tab === 'logs') {
        setActiveTab('dashboard');
        setShowLogs(true);
      } else if (tab === 'dashboard' || tab === 'chat') {
        setActiveTab('dashboard');
      } else if (tab && ['settings', 'tasks'].includes(tab)) {
        setActiveTab(tab as any);
      }
    });

    return () => unsubTab();
  }, []);

  // Handle IPC from Main Window
  useEffect(() => {
    let unlisteners: (() => void)[] = [];
    
    import('@tauri-apps/api/event').then(({ listen, emit }) => {
      listen('lucy-sync-chat', (e: any) => {
        if (e.payload) useChatStore.getState().setMessages(e.payload);
      }).then(u => unlisteners.push(u));

      listen('lucy-sync-avatar', (e: any) => {
        if (e.payload) {
          useAvatarState.getState().setIsMicOn(e.payload.isMicOn);
          useAvatarState.getState().setConnectionState(e.payload.connectionState);
        }
      }).then(u => unlisteners.push(u));

      listen('lucy-sync-logs', (e: any) => {
        if (e.payload) setLogs(e.payload);
      }).then(u => unlisteners.push(u));

      listen('lucy-sync-stats', (e: any) => {
        if (e.payload) {
          setStats({
            cpu: e.payload.cpu ?? 0,
            memory: e.payload.memory ?? '0 MB',
            latency: e.payload.latency ?? 'Offline'
          });
        }
      }).then(u => unlisteners.push(u));
      
      // Request initial sync from main window
      emit('lucy-request-sync');
    });

    return () => unlisteners.forEach(u => u && u());
  }, []);

  const handleMinimize = () => {
    try {
      getCurrentWebviewWindow().minimize();
    } catch (_) {}
  };

  const handleToggleMaximize = async () => {
    try {
      const win = getCurrentWebviewWindow();
      await win.toggleMaximize();
      const max = await win.isMaximized();
      setIsMaximized(max);
    } catch (_) {}
  };

  const closeSelf = () => {
    try {
      getCurrentWebviewWindow().close();
    } catch (e) {
      window.close();
    }
  };

  return (
    <div className="h-screen w-screen bg-[#FFF5F8] text-[#1E1926] flex flex-col font-sans select-none overflow-hidden border border-[#FCE7F3] rounded-2xl shadow-2xl">
      {/* Sleek Custom Frameless Titlebar */}
      <div 
        data-tauri-drag-region 
        className="h-11 bg-white/90 backdrop-blur-md border-b border-[#FCE7F3] px-3 flex items-center justify-between shrink-0 select-none"
      >
        {/* Left: Branding & Opening Tabs (shifted up into titlebar) */}
        <div className="flex items-center gap-2">
          {/* LUCY Brand */}
          <div className="flex items-center gap-2 pr-3 border-r border-[#FCE7F3]">
            <div className="w-5 h-5 rounded-full overflow-hidden border border-[#FCE7F3] shadow-2xs">
              <img src="/lucy-logo.png" alt="LUCY" className="w-full h-full object-cover" />
            </div>
            <span className="font-extrabold text-xs tracking-wider text-[#1E1926]">LUCY</span>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1">
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
          </div>
        </div>

        {/* Center: Draggable region */}
        <div data-tauri-drag-region className="flex-1 h-full cursor-move" />

        {/* Right: System Logs Toggle & Custom Window Controls */}
        <div className="flex items-center gap-1.5">
          {/* Logs Opening Toggle Button */}
          <button
            onClick={() => {
              if (activeTab !== 'dashboard') {
                setActiveTab('dashboard');
                setShowLogs(true);
              } else {
                setShowLogs(!showLogs);
              }
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'dashboard' && showLogs
                ? 'bg-[#FDF2F8] text-[#8B5CF6] border border-[#DDD6FE] shadow-2xs' 
                : 'hover:bg-pink-50 text-[#6B7280] hover:text-[#1E1926]'
            }`}
            title={showLogs && activeTab === 'dashboard' ? "Hide System Logs" : "Show System Logs"}
          >
            <Terminal className="w-3.5 h-3.5 text-[#8B5CF6]" />
            <span>Logs</span>
            <span className={`w-1.5 h-1.5 rounded-full ${showLogs && activeTab === 'dashboard' ? 'bg-[#10B981]' : 'bg-gray-300'}`} />
          </button>

          <div className="w-[1px] h-4 bg-[#FCE7F3] mx-1" />

          {/* Window Control Buttons */}
          <button 
            onClick={handleMinimize} 
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-pink-100/60 text-[#6B7280] hover:text-[#1E1926] transition-colors cursor-pointer"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={handleToggleMaximize} 
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-pink-100/60 text-[#6B7280] hover:text-[#1E1926] transition-colors cursor-pointer"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
          </button>
          <button 
            onClick={closeSelf} 
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500 hover:text-white text-[#6B7280] transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
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
            {showLogs && (
              <div className="w-[360px] h-full border-l border-[#FCE7F3] relative shrink-0">
                <SystemLogs
                  isVisible={true}
                  onClose={() => setShowLogs(false)}
                  logs={logs}
                  cpu={stats.cpu}
                  memory={stats.memory}
                  latency={stats.latency}
                  isTauri={true}
                  isSecondaryWindow={true}
                />
              </div>
            )}
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
    const unsub = listenCrossWindow('lucy-tasks-changed', loadTasks);
    const interval = setInterval(loadTasks, 4000);
    return () => {
      unsub();
      clearInterval(interval);
    };
  }, []);

  const handleCancelTask = (id: string) => {
    cancelScheduledTaskById(id);
    emitCrossWindow('lucy-cancel-task', id);
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
