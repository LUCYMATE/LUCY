import { useState, useEffect } from 'react';
import { useAvatarState } from '../../lib/store/avatarState';
import { useShallow } from 'zustand/react/shallow';
import { X, Lock, Unlock, Mic, MicOff, Settings, MessageCircle, Maximize2, Power, CalendarClock, Trash2, Clock, Terminal, Layers, ChevronLeft, LogOut, Sparkles } from 'lucide-react';
import { emitCrossWindow, listenCrossWindow } from '../../lib/events/crossWindowEventBus';
import { AVATAR_CONFIGURATION_CHANGED } from '../../lib/store/avatarConfiguration';

export const LIVE2D_MODELS = [
  { id: 'icy', name: 'Icy', icon: '❄️', desc: 'Ice Cheongsam' },
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
    isSleepMode,
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
    isSleepMode: s.isSleepMode,
  })));

  useEffect(() => {
    const unsub = listenCrossWindow('lucy-sleep', () => {
      onClose();
    });
    return () => unsub();
  }, [onClose]);

  if (isSleepMode) {
    return null;
  }

  const [showSizeSlider, setShowSizeSlider] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showTasksPopup, setShowTasksPopup] = useState(false);
  const [tasks, setTasks] = useState<{ id: string; targetTimeMs: number; instruction: string }[]>([]);

  const setSize = (pct: number) => {
    localStorage.setItem('lucy_avatar_size', pct.toString());
    setAvatarScale(pct / 100);
    emitCrossWindow(AVATAR_CONFIGURATION_CHANGED, { avatarSize: pct });
    emitCrossWindow('lucy-settings-changed');
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
    localStorage.setItem('lucy_avatar_locked', String(val));
    emitCrossWindow('lucy-settings-changed');
    onClose();
  };

  const handleMicToggle = async () => {
    emitCrossWindow('lucy-toggle-mic');
  };

  const openChat = () => {
    emitCrossWindow('lucy-open-chat');
    onClose();
  };

  const openSettings = () => {
    emitCrossWindow('lucy-open-settings');
    onClose();
  };

  const openLogs = () => {
    emitCrossWindow('lucy-open-logs');
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
    const unsub = listenCrossWindow('lucy-tasks-changed', handleUpdate);
    return () => unsub();
  }, [showTasksPopup]);

  const openTasks = () => {
    emitCrossWindow('lucy-open-tasks', { x, y });
    onClose();
  };

  const handleCancelTask = async (id: string) => {
    const { cancelScheduledTaskById } = await import('../../lib/gemini/gemini-live');
    cancelScheduledTaskById(id);
  };

  const sleepApp = async () => {
    try {
      onClose();
      useAvatarState.getState().setIsSleepMode(true);
      emitCrossWindow('lucy-sleep');
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

  const getResponsivePopupStyle = (popupWidth: number, popupHeight: number) => {
    const margin = 16;
    const menuExtent = radius + 30; // extent of circular menu ~115px
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;

    // Prefer right side of circular menu, fallback to left side
    const spaceRight = winW - (x + menuExtent);
    const spaceLeft = x - menuExtent;

    let leftPos: number;
    if (spaceRight >= popupWidth + margin) {
      leftPos = x + menuExtent;
    } else if (spaceLeft >= popupWidth + margin) {
      leftPos = x - menuExtent - popupWidth;
    } else {
      // Not enough room on either full side, place where there is more space and clamp
      leftPos = spaceRight >= spaceLeft
        ? Math.max(margin, Math.min(winW - popupWidth - margin, x + menuExtent))
        : Math.max(margin, Math.min(winW - popupWidth - margin, x - menuExtent - popupWidth));
    }

    // Vertically center relative to circular menu center (y), clamp within screen boundaries
    const targetTop = y - popupHeight / 2;
    const topPos = Math.max(margin, Math.min(winH - popupHeight - margin, targetTop));

    return {
      position: 'fixed' as const,
      left: `${leftPos}px`,
      top: `${topPos}px`,
      width: `${popupWidth}px`,
      zIndex: 10000,
    };
  };

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

      {/* Model Selector Popup - Dynamic Responsive Frosted Blurry Glass */}
      {showModelSelector && (
        <div
          style={getResponsivePopupStyle(285, 385)}
          className="bg-[#141022]/85 backdrop-blur-3xl border border-pink-400/40 ring-1 ring-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_30px_rgba(236,72,153,0.3)] rounded-2xl p-3.5 text-white flex flex-col gap-2.5 animate-in fade-in duration-200 pointer-events-auto select-none"
        >
          <div className="flex items-center justify-between pb-2 border-b border-pink-500/20">
            <span className="text-xs font-black uppercase tracking-wider text-pink-300 flex items-center gap-1.5 drop-shadow-sm">
              <Sparkles className="w-4 h-4 text-pink-400" /> Select Companion
            </span>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-pink-500/25 text-pink-200 font-black uppercase border border-pink-400/40 shadow-inner">
              {avatarEngine.toUpperCase()}
            </span>
          </div>

          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
            <div className="text-[10px] text-pink-300 font-extrabold uppercase tracking-widest mt-0.5 px-1 drop-shadow-sm">3D VRM Mode</div>
            <button
              onClick={() => {
                setAvatarEngine('vrm');
                emitCrossWindow(AVATAR_CONFIGURATION_CHANGED, { avatarEngine: 'vrm' });
                emitCrossWindow('lucy-settings-changed');
              }}
              className={`flex items-center justify-between p-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer group ${
                avatarEngine === 'vrm'
                  ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold border border-pink-300 shadow-[0_0_18px_rgba(236,72,153,0.55)]'
                  : 'bg-[#201A36]/80 hover:bg-[#2F2650]/90 text-white border border-white/15 hover:border-pink-400/60 shadow-sm'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-base">🌸</span>
                <div className="flex flex-col text-left">
                  <span className="leading-tight font-black text-white group-hover:text-pink-100 transition-colors">LUCY 3D</span>
                  <span className="text-[10px] text-pink-200/90 font-medium">Original 3D VRM</span>
                </div>
              </div>
              {avatarEngine === 'vrm' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/30 text-white font-black tracking-wider border border-white/40 shadow-sm">
                  ACTIVE
                </span>
              )}
            </button>

            <div className="text-[10px] text-pink-300 font-extrabold uppercase tracking-widest mt-1 px-1 drop-shadow-sm">Live2D Models</div>
            {LIVE2D_MODELS.map((m) => {
              const isCurrent = avatarEngine === 'live2d' && selectedLive2dModel === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setAvatarEngine('live2d');
                    setSelectedLive2dModel(m.id);
                    emitCrossWindow(AVATAR_CONFIGURATION_CHANGED, {
                      avatarEngine: 'live2d',
                      selectedLive2dModel: m.id,
                    });
                    emitCrossWindow('lucy-settings-changed');
                  }}
                  className={`flex items-center justify-between p-2.5 rounded-xl text-xs transition-all cursor-pointer group ${
                    isCurrent
                      ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold border border-pink-300 shadow-[0_0_18px_rgba(236,72,153,0.55)]'
                      : 'bg-[#201A36]/80 hover:bg-[#2F2650]/90 text-white border border-white/15 hover:border-pink-400/60 shadow-sm'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">{m.icon}</span>
                    <div className="flex flex-col text-left">
                      <span className="leading-tight font-black text-white group-hover:text-pink-100 transition-colors">{m.name}</span>
                      <span className={`text-[10px] font-medium ${isCurrent ? 'text-pink-100' : 'text-slate-300'}`}>{m.desc}</span>
                    </div>
                  </div>
                  {isCurrent && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/30 text-white font-black tracking-wider border border-white/40 shadow-sm">
                      ACTIVE
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Size Slider Popup - Dynamic Responsive Frosted Blurry Glass */}
      {showSizeSlider && (
        <div
          style={getResponsivePopupStyle(235, 145)}
          className="bg-[#141022]/85 backdrop-blur-3xl border border-pink-400/40 ring-1 ring-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_25px_rgba(236,72,153,0.3)] rounded-2xl p-3.5 text-white flex flex-col gap-2.5 animate-in fade-in duration-200 pointer-events-auto select-none"
        >
          <div className="flex items-center justify-between pb-1 border-b border-pink-500/20">
            <span className="text-[11px] text-pink-300 uppercase font-black tracking-wider drop-shadow-sm">Avatar Scale</span>
            <span className="text-[11px] font-mono text-white font-black">{Math.round(avatarScale * 100)}%</span>
          </div>
          <input
            type="range"
            min="50"
            max="200"
            step="10"
            value={Math.round(avatarScale * 100)}
            onChange={(e) => setSize(parseInt(e.target.value))}
            className="w-full h-2 bg-[#2B2348] rounded-full appearance-none accent-pink-500 cursor-pointer pointer-events-auto"
          />
          <div className="flex gap-1.5 mt-0.5">
            <button onClick={() => setSize(70)} className="flex-1 text-[11px] font-bold bg-[#201A36]/80 hover:bg-pink-600/50 border border-white/15 hover:border-pink-400/50 rounded-lg py-1 transition-all text-white cursor-pointer shadow-sm">
              Small
            </button>
            <button onClick={() => setSize(100)} className="flex-1 text-[11px] font-bold bg-[#201A36]/80 hover:bg-pink-600/50 border border-white/15 hover:border-pink-400/50 rounded-lg py-1 transition-all text-white cursor-pointer shadow-sm">
              Normal
            </button>
            <button onClick={() => setSize(150)} className="flex-1 text-[11px] font-bold bg-[#201A36]/80 hover:bg-pink-600/50 border border-white/15 hover:border-pink-400/50 rounded-lg py-1 transition-all text-white cursor-pointer shadow-sm">
              Large
            </button>
          </div>
        </div>
      )}

      {/* Tasks Popup - Dynamic Responsive Frosted Blurry Glass */}
      {showTasksPopup && (
        <div
          style={getResponsivePopupStyle(285, 320)}
          className="bg-[#141022]/85 backdrop-blur-3xl border border-pink-400/40 ring-1 ring-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.8),0_0_25px_rgba(236,72,153,0.3)] rounded-2xl p-3.5 text-white flex flex-col gap-2.5 animate-in fade-in duration-200 pointer-events-auto select-none"
        >
          <div className="flex items-center justify-between pb-2 border-b border-pink-500/20">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-pink-400" />
              <span className="text-xs text-white font-black uppercase tracking-wider drop-shadow-sm">Scheduled Tasks</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/25 text-pink-200 font-black border border-pink-400/40 shadow-inner">
              {tasks.length}
            </span>
          </div>
          <div className="flex flex-col gap-2 max-h-52 overflow-y-auto custom-scrollbar pr-1">
            {tasks.length === 0 ? (
              <p className="text-xs text-slate-300 font-medium text-center py-4">No scheduled tasks active.</p>
            ) : (
              tasks.map((t) => (
                <div key={t.id} className="bg-[#201A36]/80 border border-white/15 rounded-xl p-2.5 flex flex-col gap-1 relative group shadow-sm">
                  <p className="text-[11px] text-white font-semibold line-clamp-2 pr-6">{t.instruction}</p>
                  <p className="text-[10px] text-pink-300 font-mono font-bold flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {new Date(t.targetTimeMs).toLocaleTimeString()}
                  </p>
                  <button
                    onClick={() => handleCancelTask(t.id)}
                    className="absolute right-2 top-2 p-1 hover:bg-red-500/40 rounded-lg text-red-300 transition-colors opacity-80 group-hover:opacity-100 cursor-pointer"
                    title="Cancel Task"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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
