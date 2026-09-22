import { useState, useEffect } from 'react';
import { useAvatarState } from '../../lib/store/avatarState';
import { useShallow } from 'zustand/react/shallow';
import { X, Lock, Unlock, Mic, MicOff, Settings, MessageCircle, Maximize2, Power, CalendarClock, Trash2, Clock, Terminal, Layers, ChevronLeft, LogOut, Sparkles } from 'lucide-react';
import { emitCrossWindow, listenCrossWindow } from '../../lib/events/crossWindowEventBus';

export const LIVE2D_MODELS = [
  { id: 'rozen', name: 'Rozen', icon: '🌹', desc: 'Maiden Doll' },
  { id: 'shiroko', name: 'Shiroko', icon: '🐺', desc: 'Blue Archive' },
  { id: 'maya', name: 'Maya', icon: '🐱', desc: 'Catgirl Maid' },
  { id: 'friday', name: 'Friday', icon: '🎀', desc: 'Haru Assistant' },
  { id: 'venom', name: 'Venom', icon: '🖤', desc: 'Natori Companion' },
];

export function AvatarContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const {
    isAvatarLocked,
    setIsAvatarLocked,
    avatarScale,
    setAvatarScale,
    isMicOn,
    avatarEngine,
    setAvatarEngine,
    selectedLive2dModel,
    setSelectedLive2dModel,
  } = useAvatarState(useShallow(s => ({
    isAvatarLocked: s.isAvatarLocked,
    setIsAvatarLocked: s.setIsAvatarLocked,
    avatarScale: s.avatarScale,
    setAvatarScale: s.setAvatarScale,
    isMicOn: s.isMicOn,
    avatarEngine: s.avatarEngine,
    setAvatarEngine: s.setAvatarEngine,
    selectedLive2dModel: s.selectedLive2dModel,
    setSelectedLive2dModel: s.setSelectedLive2dModel,
  })));

  const [showSizeSlider, setShowSizeSlider] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showTasksPopup, setShowTasksPopup] = useState(false);
  const [tasks, setTasks] = useState<{ id: string; targetTimeMs: number; instruction: string }[]>([]);

  const setSize = (pct: number) => {
    localStorage.setItem('soltini_avatar_size', pct.toString());
    setAvatarScale(pct / 100);
    emitCrossWindow('soltini-settings-changed');
  };

  const handleLockAvatar = () => {
    const val = !isAvatarLocked;
    setIsAvatarLocked(val);
    const s = useAvatarState.getState();
    if (val) {
      s.setLockedPosition({ ...s.worldPosition });
    } else {
      s.setLockedPosition(null);
    }
    localStorage.setItem('soltini_avatar_locked', String(val));
    emitCrossWindow('soltini-settings-changed');
    onClose();
  };

  const handleMicToggle = async () => {
    emitCrossWindow('soltini-toggle-mic');
  };

  const openChat = () => {
    emitCrossWindow('soltini-open-chat');
    onClose();
  };

  const openSettings = () => {
    emitCrossWindow('soltini-open-settings');
    onClose();
  };

  const openLogs = () => {
    emitCrossWindow('soltini-open-logs');
    onClose();
  };

  useEffect(() => {
    if (!showTasksPopup) return;
    const fetchTasks = async () => {
      const { getScheduledTasks } = await import('../../lib/gemini/gemini-live');
      setTasks(getScheduledTasks());
    };
    fetchTasks();
    const handleUpdate = () => fetchTasks();
    const unsub = listenCrossWindow('soltini-tasks-changed', handleUpdate);
    return () => unsub();
  }, [showTasksPopup]);

  const openTasks = () => {
    emitCrossWindow('soltini-open-tasks', { x, y });
    onClose();
  };

  const handleCancelTask = async (id: string) => {
    const { cancelScheduledTaskById } = await import('../../lib/gemini/gemini-live');
    cancelScheduledTaskById(id);
  };

  const sleepApp = async () => {
    try {
      useAvatarState.getState().setIsSleepMode(true);
      emitCrossWindow('soltini-sleep');
    } catch (e) {
      console.warn('Error entering sleep mode:', e);
    }
  };

  // Radial math
  const radius = 85;

  const mainItems = [
    { id: 'mic', icon: isMicOn ? <Mic className="w-5 h-5 text-pink-400" /> : <MicOff className="w-5 h-5 text-white/50" />, action: handleMicToggle, label: 'Mic' },
    { id: 'chat', icon: <MessageCircle className="w-5 h-5 text-blue-400" />, action: openChat, label: 'Chat' },
    {
      id: 'models',
      icon: <Sparkles className="w-5 h-5 text-yellow-400" />,
      action: () => {
        setShowModelSelector(!showModelSelector);
        setShowSizeSlider(false);
        setShowTasksPopup(false);
        setShowSubMenu(false);
      },
      label: 'Avatar Model',
    },
    { id: 'settings', icon: <Settings className="w-5 h-5 text-gray-300" />, action: openSettings, label: 'Settings' },
    {
      id: 'size',
      icon: <Maximize2 className="w-5 h-5 text-green-400" />,
      action: () => {
        setShowSizeSlider(!showSizeSlider);
        setShowModelSelector(false);
        setShowTasksPopup(false);
        setShowSubMenu(false);
      },
      label: 'Size',
    },
    { id: 'lock', icon: isAvatarLocked ? <Lock className="w-5 h-5 text-yellow-400" /> : <Unlock className="w-5 h-5 text-white/50" />, action: handleLockAvatar, label: 'Lock' },
    {
      id: 'apps',
      icon: <Layers className="w-5 h-5 text-blue-400" />,
      action: () => {
        setShowSubMenu(true);
        setShowModelSelector(false);
        setShowSizeSlider(false);
        setShowTasksPopup(false);
      },
      label: 'More',
    },
    { id: 'sleep', icon: <Power className="w-5 h-5 text-red-500" />, action: sleepApp, label: 'Sleep' },
  ];

  const subItems = [
    { id: 'back', icon: <ChevronLeft className="w-5 h-5 text-white/80" />, action: () => setShowSubMenu(false), label: 'Back' },
    { id: 'logs', icon: <Terminal className="w-5 h-5 text-purple-400" />, action: openLogs, label: 'Logs' },
    { id: 'tasks', icon: <CalendarClock className="w-5 h-5 text-purple-400" />, action: openTasks, label: 'Tasks' },
    {
      id: 'quit',
      icon: <LogOut className="w-5 h-5 text-red-500" />,
      action: () => {
        import('@tauri-apps/api/core').then(({ invoke }) => invoke('exit_app')).catch(() => window.close());
      },
      label: 'Quit',
    },
  ];

  const items = showSubMenu ? subItems : mainItems;

  return (
    <div
      className="avatar-context-menu fixed pointer-events-auto z-[9999] animate-in fade-in zoom-in-95 duration-200"
      style={{ left: x, top: y, width: 0, height: 0 }}
    >
      {/* Pink Round Ribbon Path (Track) */}
      <svg
        className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none drop-shadow-[0_0_10px_rgba(236,72,153,0.4)]"
        width={radius * 2 + 60}
        height={radius * 2 + 60}
      >
        <circle
          cx={radius + 30}
          cy={radius + 30}
          r={radius}
          fill="none"
          stroke="rgba(236,72,153,0.25)"
          strokeWidth="44"
          className="pointer-events-auto"
        />
        <circle
          cx={radius + 30}
          cy={radius + 30}
          r={radius}
          fill="none"
          stroke="rgba(236,72,153,0.5)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      </svg>

      <button
        onClick={onClose}
        title="Close Menu"
        className="absolute -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full glass border border-pink-300 flex items-center justify-center hover:bg-pink-500/40 transition-colors shadow-lg z-10 pointer-events-auto cursor-pointer"
      >
        <X className="w-6 h-6 text-white" />
      </button>

      {items.map((item, i) => {
        const angle = (i * (360 / items.length) - 90) * (Math.PI / 180);
        const bx = Math.cos(angle) * radius;
        const by = Math.sin(angle) * radius;
        return (
          <button
            key={item.id}
            onClick={item.action}
            title={item.label}
            className="absolute -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-blue-600/30 backdrop-blur-md border border-blue-400/30 flex items-center justify-center hover:bg-blue-500/60 hover:border-blue-400/80 hover:shadow-[0_0_15px_rgba(59,130,246,0.6)] transition-all duration-300 hover:scale-110 shadow-md pointer-events-auto cursor-pointer"
            style={{ left: bx, top: by }}
          >
            {item.icon}
          </button>
        );
      })}

      {/* Model Selector Popup */}
      {showModelSelector && (
        <div className="absolute top-24 -translate-x-1/2 w-64 glass rounded-xl p-3 border border-pink-300/30 shadow-2xl animate-in slide-in-from-top-2 fade-in pointer-events-auto flex flex-col gap-2 bg-[#1E1926]/90 backdrop-blur-xl text-white">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-xs font-bold uppercase tracking-wider text-pink-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Select Avatar
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 font-semibold uppercase">
              {avatarEngine.toUpperCase()}
            </span>
          </div>

          <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto custom-scrollbar pr-0.5">
            <div className="text-[10px] text-white/50 font-bold uppercase mt-1 px-1">3D VRM Mode</div>
            <button
              onClick={() => {
                setAvatarEngine('vrm');
                emitCrossWindow('soltini-settings-changed');
              }}
              className={`flex items-center justify-between p-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                avatarEngine === 'vrm'
                  ? 'bg-gradient-to-r from-pink-500/40 to-purple-500/40 border border-pink-400/60 text-white font-bold'
                  : 'bg-white/5 hover:bg-white/10 text-white/80'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">🌸</span>
                <span>LUCY 3D</span>
              </div>
              {avatarEngine === 'vrm' && <span className="text-[10px] text-pink-300 font-bold">ACTIVE</span>}
            </button>

            <div className="text-[10px] text-white/50 font-bold uppercase mt-2 px-1">Live2D Models</div>
            {LIVE2D_MODELS.map((m) => {
              const isCurrent = avatarEngine === 'live2d' && selectedLive2dModel === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setAvatarEngine('live2d');
                    setSelectedLive2dModel(m.id);
                    emitCrossWindow('soltini-settings-changed');
                  }}
                  className={`flex items-center justify-between p-2 rounded-lg text-xs transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-gradient-to-r from-pink-500/40 to-purple-500/40 border border-pink-400/60 text-white font-bold'
                      : 'bg-white/5 hover:bg-white/10 text-white/80'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{m.icon}</span>
                    <div className="flex flex-col text-left">
                      <span className="leading-tight">{m.name}</span>
                      <span className="text-[9px] text-white/50">{m.desc}</span>
                    </div>
                  </div>
                  {isCurrent && <span className="text-[10px] text-pink-300 font-bold">ACTIVE</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showSizeSlider && (
        <div className="absolute top-24 -translate-x-1/2 w-48 glass rounded-xl p-3 border border-white/10 flex flex-col gap-2 shadow-xl animate-in slide-in-from-top-2 fade-in pointer-events-auto bg-[#1E1926]/90 backdrop-blur-xl">
          <span className="text-[10px] text-white/50 uppercase text-center font-bold">Avatar Size</span>
          <input
            type="range"
            min="50"
            max="200"
            step="10"
            value={Math.round(avatarScale * 100)}
            onChange={(e) => setSize(parseInt(e.target.value))}
            className="w-full h-1.5 bg-white/20 rounded-full appearance-none accent-pink-500 cursor-pointer pointer-events-auto"
          />
          <div className="flex gap-1 mt-1">
            <button onClick={() => setSize(70)} className="flex-1 text-[10px] bg-white/5 hover:bg-white/15 rounded py-1 transition-colors text-white cursor-pointer">
              S
            </button>
            <button onClick={() => setSize(100)} className="flex-1 text-[10px] bg-white/5 hover:bg-white/15 rounded py-1 transition-colors text-white cursor-pointer">
              M
            </button>
            <button onClick={() => setSize(150)} className="flex-1 text-[10px] bg-white/5 hover:bg-white/15 rounded py-1 transition-colors text-white cursor-pointer">
              L
            </button>
          </div>
        </div>
      )}

      {showTasksPopup && (
        <div className="absolute top-24 -translate-x-1/2 w-64 glass rounded-xl p-3 border border-white/10 shadow-xl animate-in slide-in-from-top-2 fade-in pointer-events-auto flex flex-col gap-2 bg-[#1E1926]/90 backdrop-blur-xl">
          <div className="flex items-center gap-2 pb-2 border-b border-white/10">
            <CalendarClock className="w-4 h-4 text-pink-400" />
            <span className="text-xs text-white/90 font-bold uppercase">Scheduled Tasks</span>
          </div>
          <div className="flex flex-col gap-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
            {tasks.length === 0 ? (
              <p className="text-xs text-white/40 text-center py-2">No tasks right now.</p>
            ) : (
              tasks.map((t) => (
                <div key={t.id} className="bg-white/5 rounded-lg p-2 flex flex-col gap-1 relative group">
                  <p className="text-[10px] text-white/80 line-clamp-2 pr-5">{t.instruction}</p>
                  <p className="text-[9px] text-pink-300 font-mono flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {new Date(t.targetTimeMs).toLocaleTimeString()}
                  </p>
                  <button
                    onClick={() => handleCancelTask(t.id)}
                    className="absolute right-1 top-1 p-1 hover:bg-red-500/20 rounded text-red-400 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
