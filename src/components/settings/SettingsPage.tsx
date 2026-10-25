import { useState, useEffect, useRef } from 'react';
import { Settings as SettingsIcon, Box, ArrowLeft, Volume2, Mic, Key, Keyboard, Video, Brain, User, ShieldCheck, Download, Sparkles, ExternalLink, Info, RefreshCw, Smartphone, Activity, Play, Square, Check, X, RotateCcw } from 'lucide-react';
import { AssetLibrary } from './AssetLibrary';
import { PhoneLinkTab } from './PhoneLinkTab';
import { logger } from '../../lib/store/logger';
import { useAvatarState } from '../../lib/store/avatarState';
import { vectorMemory, MemoryFact } from '../../lib/store/vectorMemory';
import { userAuth } from '../../lib/auth/userAuth';
import { checkAppUpdate, downloadUpdate, AppUpdateInfo } from '../../lib/system/updateChecker';
import { openExternalUrl } from '../../lib/system/tauriBridge';
import { emitCrossWindow, listenCrossWindow } from '../../lib/events/crossWindowEventBus';
import { AVATAR_CONFIGURATION_CHANGED, type AvatarConfigurationChange } from '../../lib/store/avatarConfiguration';
import { LIVE2D_MODELS } from '../../config/live2d-models';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'general' | 'account' | 'devices' | 'link' | 'api' | 'shortcuts' | 'assets' | 'personalized' | 'about' | 'wake-test'>('general');
  const [session, setSession] = useState(userAuth.getSession());
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatusMsg, setUpdateStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsub = userAuth.subscribe(s => setSession(s));
    checkAppUpdate().then(info => {
      if (info && info.updateAvailable) {
        setUpdateInfo(info);
      }
    });
    return () => { unsub(); };
  }, []);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [memories, setMemories] = useState<MemoryFact[]>([]);
  
  const [micId, setMicId] = useState(localStorage.getItem('lucy_mic_id') || 'default');
  const [micBoost, setMicBoost] = useState(() => {
    const val = localStorage.getItem('lucy_mic_boost');
    return val ? parseFloat(val) : 2.0;
  });

  const handleMicBoostChange = (val: number) => {
    setMicBoost(val);
    localStorage.setItem('lucy_mic_boost', String(val));
    emitCrossWindow('lucy-mic-boost-changed', { boost: val });
  };
  const [camId, setCamId] = useState(localStorage.getItem('lucy_camera_id') || '');
  const [voice, setVoice] = useState(localStorage.getItem('lucy_voice') || 'Aoede');
  const [model, setModel] = useState(() => {
    const saved = localStorage.getItem('lucy_model');
    return saved === 'gemini-3.1-flash-live-preview' ? saved : 'gemini-3.1-flash-live-preview';
  });
  const [avatarSize, setAvatarSize] = useState(parseInt(localStorage.getItem('lucy_avatar_size') || '100'));
  
  const isMac = window.navigator.userAgent.includes('Mac');
  const isLinux = window.navigator.userAgent.includes('Linux');

  const handleSetupWayland = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('setup_wayland_automation');
      logger.add('success', 'System', 'Wayland daemon started');
    } catch (e: any) {
      logger.add('error', 'System', `Wayland setup failed: ${e}`);
    }
  };
  
  const [autoMic, setAutoMic] = useState(() => {
    const val = localStorage.getItem('lucy_auto_mic');
    return val === null ? true : val === 'true';
  });
  useEffect(() => {
    localStorage.removeItem('lucy_headphone_mode');
  }, []);
  const [avatarLocked, setAvatarLocked] = useState(localStorage.getItem('lucy_avatar_locked') === 'true');
  const {
    avatarEngine,
    setAvatarEngine,
    selectedLive2dModel,
    setSelectedLive2dModel,
  } = useAvatarState();
  
  const [systemInstruction, setSystemInstruction] = useState(() => {
    const val = localStorage.getItem('lucy_system_instruction') || '';
    if (val.includes('You are LUCY') || val.includes('Satish Acharya') || val.includes('a playful and bubbly')) return '';
    return val;
  });
  const [mainApiKey, setMainApiKey] = useState(localStorage.getItem('lucy_main_api_key') || '');
  const [altApiKey, setAltApiKey] = useState(localStorage.getItem('lucy_alt_api_key') || '');
  const [tavilyApiKey, setTavilyApiKey] = useState(localStorage.getItem('lucy_tavily_api_key') || '');

  useEffect(() => {
    const loadInputDevices = async () => {
      try {
        const microphones = await invoke<Array<{ id: string; label: string }>>('list_native_microphones');
        const cameras = await navigator.mediaDevices?.enumerateDevices?.() || [];
        const nativeMicDevices = microphones.map((device) => ({
          deviceId: device.id,
          groupId: 'native-audio',
          kind: 'audioinput' as MediaDeviceKind,
          label: device.label,
          toJSON: () => ({ deviceId: device.id, kind: 'audioinput', label: device.label }),
        } as MediaDeviceInfo));
        setDevices([...nativeMicDevices, ...cameras.filter(device => device.kind === 'videoinput')]);
        setMicId((current) => {
          if (current === 'default' || microphones.some(device => device.id === current)) return current;
          localStorage.setItem('lucy_mic_id', 'default');
          return 'default';
        });
      } catch (error) {
        logger.add('warning', 'Microphone', `Could not enumerate native microphone devices: ${String(error)}`);
        navigator.mediaDevices?.enumerateDevices?.().then(items => setDevices(items.filter(device => device.kind === 'videoinput'))).catch(() => {});
      }
    };
    void loadInputDevices();
    
    const loadMemories = () => setMemories(vectorMemory.getMemories());
    loadMemories();
    const unsubMemory = listenCrossWindow('lucy-memory-updated', loadMemories);
    const unsubAvatarConfiguration = listenCrossWindow<AvatarConfigurationChange>(AVATAR_CONFIGURATION_CHANGED, (change) => {
      const avatarState = useAvatarState.getState();
      if (change.avatarEngine === 'vrm' || change.avatarEngine === 'live2d') {
        avatarState.setAvatarEngine(change.avatarEngine);
      }
      if (typeof change.selectedLive2dModel === 'string' && change.selectedLive2dModel.trim()) {
        avatarState.setSelectedLive2dModel(change.selectedLive2dModel);
      }
      if (typeof change.avatarSize === 'number' && Number.isFinite(change.avatarSize)) {
        const size = Math.max(50, Math.min(200, Math.round(change.avatarSize)));
        setAvatarSize(size);
        localStorage.setItem('lucy_avatar_size', String(size));
        avatarState.setAvatarScale(size / 100);
      }
    });
    return () => {
      unsubMemory();
      unsubAvatarConfiguration();
    };
  }, []);

  const handleMicChange = (val: string) => {
    setMicId(val);
    localStorage.setItem('lucy_mic_id', val);
    logger.add('success', 'Settings', 'Microphone changed');
    emitCrossWindow('lucy-core-settings-changed');
  };

  const handleCamChange = (val: string) => {
    setCamId(val);
    localStorage.setItem('lucy_camera_id', val);
    logger.add('success', 'Settings', 'Camera changed');
    emitCrossWindow('lucy-core-settings-changed');
  };

  const handleVoiceChange = (val: string) => {
    setVoice(val);
    localStorage.setItem('lucy_voice', val);
    logger.add('success', 'Settings', 'Voice changed');
    emitCrossWindow('lucy-core-settings-changed');
  };

  const handleModelChange = (val: string) => {
    setModel(val);
    localStorage.setItem('lucy_model', val);
    logger.add('success', 'Settings', `AI Model changed to ${val}`);
    emitCrossWindow('lucy-core-settings-changed');
  };

  const handleAvatarSizeChange = (val: number) => {
    const size = Math.max(50, Math.min(200, Math.round(val)));
    setAvatarSize(size);
    localStorage.setItem('lucy_avatar_size', String(size));
    useAvatarState.getState().setAvatarScale(size / 100);
    emitCrossWindow(AVATAR_CONFIGURATION_CHANGED, { avatarSize: size });
    logger.add('success', 'Settings', 'Avatar size changed');
    emitCrossWindow('lucy-settings-changed');
  };

  const handleAutoMicChange = (val: boolean) => {
    setAutoMic(val);
    localStorage.setItem('lucy_auto_mic', String(val));
    logger.add('info', 'Settings', `Auto-Start Mic set to ${val}`);
    emitCrossWindow('lucy-core-settings-changed');
  };

  const handleAvatarLockedChange = (val: boolean) => {
    setAvatarLocked(val);
    localStorage.setItem('lucy_avatar_locked', String(val));
    useAvatarState.getState().setIsAvatarLocked(val);
    emitCrossWindow('lucy-settings-changed');
  };

  const handleInstructionChange = (val: string) => {
    setSystemInstruction(val);
    localStorage.setItem('lucy_system_instruction', val);
    emitCrossWindow('lucy-core-settings-changed');
  };

  const handleMainApiKeyChange = (val: string) => {
    setMainApiKey(val);
    localStorage.setItem('lucy_main_api_key', val);
    emitCrossWindow('lucy-api-key-saved');
    emitCrossWindow('lucy-core-settings-changed');
  };

  const handleAltApiKeyChange = (val: string) => {
    setAltApiKey(val);
    localStorage.setItem('lucy_alt_api_key', val);
    emitCrossWindow('lucy-core-settings-changed');
  };

  const handleTavilyApiKeyChange = (val: string) => {
    setTavilyApiKey(val);
    localStorage.setItem('lucy_tavily_api_key', val);
    emitCrossWindow('lucy-core-settings-changed');
  };

  return (
    <div className="flex w-full h-full bg-gradient-to-br from-[#FFF5F8] via-[#FFFFFF] to-[#FFF0F5] border border-[#FCE7F3] shadow-2xl rounded-[32px] overflow-hidden text-[#1E1926] animate-in slide-in-from-bottom-10 fade-in duration-500 font-sans">
      
      {/* Sidebar Navigation */}
      <div className="w-64 bg-[#FFF5F8]/90 backdrop-blur-md border-r border-[#FCE7F3] p-6 flex flex-col gap-5 shrink-0 h-full min-h-0 overflow-hidden">
        <button 
          onClick={onClose}
          className="flex items-center gap-2 text-[#6B7280] hover:text-[#1E1926] transition-colors self-start px-2 py-1 -ml-2 rounded-lg hover:bg-white/80 shrink-0 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Back to System
        </button>

        <h2 className="text-2xl font-extrabold tracking-tight text-[#1E1926] shrink-0">Settings</h2>

        <nav className="flex flex-col gap-1.5 overflow-y-auto flex-1 min-h-0 pr-1 settings-scrollbar">
          <button 
            onClick={() => setActiveTab('account')}
            className={`flex items-center justify-between px-4 py-3 rounded-xl transition-colors text-left font-semibold ${
              activeTab === 'account' ? 'bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white shadow-md shadow-pink-500/20' : 'hover:bg-white/80 text-[#6B7280] hover:text-[#1E1926]'
            }`}
          >
            <div className="flex items-center gap-3">
              <User className="w-5 h-5" /> Account &amp; Pro
            </div>
            {userAuth.isPro() && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${activeTab === 'account' ? 'bg-white/20 text-white border-white/30' : 'bg-amber-400/20 text-amber-600 border-amber-400/40'}`}>PRO</span>
            )}
          </button>

          <button 
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-semibold ${
              activeTab === 'general' ? 'bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white shadow-md shadow-pink-500/20' : 'hover:bg-white/80 text-[#6B7280] hover:text-[#1E1926]'
            }`}
          >
            <SettingsIcon className="w-5 h-5" /> General
          </button>
          
          <button 
            onClick={() => setActiveTab('devices')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-semibold ${
              activeTab === 'devices' ? 'bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white shadow-md shadow-pink-500/20' : 'hover:bg-white/80 text-[#6B7280] hover:text-[#1E1926]'
            }`}
          >
            <Volume2 className="w-5 h-5" /> Devices
          </button>

          <button 
            onClick={() => setActiveTab('link')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-semibold ${
              activeTab === 'link' ? 'bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white shadow-md shadow-pink-500/20' : 'hover:bg-white/80 text-[#6B7280] hover:text-[#1E1926]'
            }`}
          >
            <Smartphone className="w-5 h-5" /> Phone Link
          </button>

          <button 
            onClick={() => setActiveTab('api')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-semibold ${
              activeTab === 'api' ? 'bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white shadow-md shadow-pink-500/20' : 'hover:bg-white/80 text-[#6B7280] hover:text-[#1E1926]'
            }`}
          >
            <Key className="w-5 h-5" /> AI &amp; API Keys
          </button>

          <button 
            onClick={() => setActiveTab('assets')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-semibold ${
              activeTab === 'assets' ? 'bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white shadow-md shadow-pink-500/20' : 'hover:bg-white/80 text-[#6B7280] hover:text-[#1E1926]'
            }`}
          >
            <Box className="w-5 h-5" /> Asset Library
          </button>

          <button 
            onClick={() => setActiveTab('personalized')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-semibold ${
              activeTab === 'personalized' ? 'bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white shadow-md shadow-pink-500/20' : 'hover:bg-white/80 text-[#6B7280] hover:text-[#1E1926]'
            }`}
          >
            <Brain className="w-5 h-5" /> Personalized
          </button>
          
          <button 
            onClick={() => setActiveTab('shortcuts')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-semibold ${
              activeTab === 'shortcuts' ? 'bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white shadow-md shadow-pink-500/20' : 'hover:bg-white/80 text-[#6B7280] hover:text-[#1E1926]'
            }`}
          >
            <Keyboard className="w-5 h-5" /> Shortcuts
          </button>

          <button 
            onClick={() => setActiveTab('about')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-semibold ${
              activeTab === 'about' ? 'bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white shadow-md shadow-pink-500/20' : 'hover:bg-white/80 text-[#6B7280] hover:text-[#1E1926]'
            }`}
          >
            <Info className="w-5 h-5" /> About & System
          </button>
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-12">
        {/* App Update Banner */}
        {updateInfo && (
          <div className="mb-8 p-6 rounded-2xl bg-gradient-to-r from-[#9D174D] via-[#6D28D9] to-[#3730A3] border border-purple-400/30 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-white">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-white/15 rounded-xl border border-white/20 text-pink-200 shrink-0">
                <Sparkles className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-white">New Update Available: v{updateInfo.version}</h3>
                  <span className="bg-white/20 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border border-white/30 uppercase tracking-wide">
                    {updateInfo.platform}
                  </span>
                </div>
                <p className="text-xs text-pink-100 mt-1 max-w-xl line-clamp-2">
                  {updateInfo.notes}
                </p>
              </div>
            </div>
            <button
              onClick={() => downloadUpdate(updateInfo.url)}
              className="px-5 py-2.5 bg-white hover:bg-pink-50 text-[#6D28D9] hover:text-[#5B21B6] font-extrabold rounded-xl shadow-lg transition-all flex items-center gap-2 text-sm shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4" /> Download Update
            </button>
          </div>
        )}

        {activeTab === 'account' && (
          <div className="flex flex-col gap-6 max-w-2xl w-full">
            <div>
              <h3 className="text-2xl font-black mb-1 text-[#1E1926]">Account &amp; Subscription</h3>
              <p className="text-[#6B7280] text-xs mb-4">Manage your Google identity, LUCY subscription, and cross-device licenses.</p>
            </div>

            {/* Trial Active Banner */}
            {session?.isTrial && (
              <div className="bg-gradient-to-r from-amber-500/15 via-pink-500/10 to-purple-500/10 border border-amber-400/50 rounded-2xl p-5 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-amber-400/20 border border-amber-400/30 text-amber-600 flex items-center justify-center text-xl font-bold">
                    ⏳
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-[#1E1926]">10-Day Ultimate Bundle Trial Active</h4>
                      <span className="bg-amber-400 text-black text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm">
                        {session?.daysRemaining ?? 10} DAYS LEFT
                      </span>
                    </div>
                    <p className="text-xs text-[#6B7280] mt-0.5">
                      Full dual-device Pro privileges unlocked on Windows PC &amp; Android Mobile.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => openExternalUrl(`https://lucymate.vercel.app/checkout?plan=bundle_pro&email=${encodeURIComponent(session?.email || '')}`)}
                  className="px-4 py-2 bg-gradient-to-r from-[#F43F8E] to-[#8B5CF6] text-white text-xs font-bold rounded-xl shadow-md hover:opacity-95 transition-all shrink-0"
                >
                  Keep Bundle ($3/mo)
                </button>
              </div>
            )}

            {/* Profile Card */}
            <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-[#F43F8E] to-[#8B5CF6] flex items-center justify-center text-xl font-bold text-white shadow-md overflow-hidden border-2 border-[#FCE7F3]">
                  {session?.avatarUrl ? (
                    <img src={session.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    session?.name?.[0] || 'L'
                  )}
                </div>
                <div>
                  <h4 className="text-lg font-bold text-[#1E1926] flex items-center gap-2">
                    {session?.name || 'LUCY User'}
                    {session?.isTrial ? (
                      <span className="bg-amber-400/20 text-amber-600 border border-amber-400/40 text-[10px] font-black px-2.5 py-0.5 rounded-full">
                        TRIAL ACTIVE
                      </span>
                    ) : userAuth.isPro() ? (
                      <span className="bg-gradient-to-r from-amber-400 to-yellow-500 text-black text-xs font-black px-2.5 py-0.5 rounded-full shadow-sm">
                        {session?.tier === 'bundle_pro' ? 'BUNDLE PRO' : session?.tier === 'pc_pro' ? 'PC PRO' : 'PRO'}
                      </span>
                    ) : session?.tier === 'mobile_pro' ? (
                      <span className="bg-purple-500/20 text-purple-600 border border-purple-500/30 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                        MOBILE PRO (FREE ON PC)
                      </span>
                    ) : (
                      <span className="bg-gray-100 text-gray-500 text-xs font-medium px-2 py-0.5 rounded-full">FREE</span>
                    )}
                  </h4>
                  <p className="text-xs text-[#F43F8E] mt-0.5 font-bold">{userAuth.getPlanDisplayName()}</p>
                  <p className="text-xs text-[#6B7280]">{session?.email || 'Not signed in'}</p>
                </div>
              </div>

              {session ? (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => userAuth.refreshStatus()}
                    className="px-3.5 py-2 bg-[#FFF5F8] hover:bg-[#FCE7F3] border border-[#FCE7F3] text-[#1E1926] text-xs font-bold rounded-xl transition-colors"
                  >
                    Sync Status
                  </button>
                  <button
                    onClick={() => userAuth.logout()}
                    className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-xl transition-colors border border-red-200"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3 items-end">
                  <button
                    onClick={() => {
                      emitCrossWindow('lucy-open-settings');
                    }}
                    className="px-5 py-2.5 bg-[#F43F8E] text-white hover:opacity-90 text-xs font-bold rounded-xl transition-all shadow-md flex items-center gap-2"
                  >
                    Sign in with Google
                  </button>
                </div>
              )}
            </div>
            
            {/* Upgrade to Pro Banner */}
            {!userAuth.isPro() && (
              userAuth.isMobileOnlyPro() ? (
                <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-300 rounded-2xl p-6 flex items-center justify-between shadow-sm">
                  <div>
                    <h4 className="text-base font-bold text-purple-700">Upgrade to LUCY Ultimate Bundle</h4>
                    <p className="text-xs text-[#6B7280] mt-1 max-w-sm">
                      You have an active Android Mobile Pro license! Upgrade to the Ultimate Bundle (dual PC + Mobile) to unlock Windows custom 3D models and automation.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      onClick={() => openExternalUrl(`https://lucymate.vercel.app/checkout?plan=bundle_pro&email=${encodeURIComponent(session?.email || '')}`)}
                      className="px-4 py-2 bg-gradient-to-r from-[#F43F8E] to-[#8B5CF6] hover:opacity-90 text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center gap-2"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Get Ultimate Bundle ($3 / ₹299)
                    </button>
                    <button
                      onClick={() => openExternalUrl(`https://lucymate.vercel.app/checkout?plan=pc_pro&email=${encodeURIComponent(session?.email || '')}`)}
                      className="px-4 py-1.5 bg-white border border-[#FCE7F3] hover:bg-[#FFF5F8] text-[#1E1926] text-xs font-semibold rounded-xl transition-all text-center"
                    >
                      Get Windows PC Pro ($2 / ₹199)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border border-amber-300 rounded-2xl p-6 flex items-center justify-between shadow-sm">
                  <div>
                    <h4 className="text-base font-bold text-amber-700">Unlock LUCY PRO</h4>
                    <p className="text-xs text-[#6B7280] mt-1 max-w-sm">Get access to custom 3D avatars, OS automation, Python script execution, and dual-screen companion features.</p>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      onClick={() => openExternalUrl(`https://lucymate.vercel.app/checkout?plan=pc_pro&email=${encodeURIComponent(session?.email || '')}`)}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl transition-colors shadow-sm flex items-center gap-2"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Get Windows PC Pro ($2 / ₹199)
                    </button>
                    <button
                      onClick={() => openExternalUrl(`https://lucymate.vercel.app/checkout?plan=bundle_pro&email=${encodeURIComponent(session?.email || '')}`)}
                      className="px-4 py-1.5 bg-white border border-[#FCE7F3] hover:bg-[#FFF5F8] text-[#1E1926] text-xs font-semibold rounded-xl transition-colors text-center"
                    >
                      Get Ultimate Bundle ($3 / ₹299)
                    </button>
                  </div>
                </div>
              )
            )}

            {/* Feature Access Matrix */}
            <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-6 flex flex-col gap-4">
              <h4 className="text-xs font-bold text-[#1E1926] uppercase tracking-wider">Plan Capability Comparison</h4>
              
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 bg-[#FFF5F8] rounded-xl border border-[#FCE7F3]">
                  <div className="font-bold text-[#1E1926] mb-1.5 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Free Tier Includes
                  </div>
                  <ul className="text-[#6B7280] space-y-1 pl-3 list-disc">
                    <li>3D Avatar Model rendering &amp; lip-sync speech</li>
                    <li>Full natural conversational AI voice chat</li>
                    <li>Basic system statistics &amp; settings customization</li>
                  </ul>
                </div>

                <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200">
                  <div className="font-bold text-amber-800 mb-1.5 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-600" /> Pro Tier Unlocks
                  </div>
                  <ul className="text-amber-900/80 space-y-1 pl-3 list-disc">
                    <li>Custom 3D VRM &amp; FBX asset uploads</li>
                    <li>Special pose animations (kissing, dancing)</li>
                    <li>OS Automation, clicking &amp; keyboard shortcuts</li>
                    <li>Python script &amp; terminal command execution</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'general' && (
          <div className="flex flex-col gap-6 max-w-2xl w-full">
            <div>
              <h3 className="text-2xl font-black mb-1 text-[#1E1926]">General Configuration</h3>
              <p className="text-[#6B7280] text-xs mb-4">Customize display sizes, avatar anchors, and window behavior.</p>
            </div>

            <div className="flex flex-col gap-4">
              
              {/* Avatar Engine & Model Selector */}
              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex flex-col gap-4 transition-colors">
                <div>
                  <label className="block text-sm font-bold text-[#1E1926]">Avatar Engine & Companion Model</label>
                  <p className="text-xs text-[#6B7280] mt-0.5">Switch between 3D VRM models and 2D Live2D companions.</p>
                </div>

                {/* Engine Mode Tabs */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setAvatarEngine('vrm');
                      emitCrossWindow(AVATAR_CONFIGURATION_CHANGED, { avatarEngine: 'vrm' });
                      emitCrossWindow('lucy-settings-changed');
                    }}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      avatarEngine === 'vrm'
                        ? 'bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white border-pink-500 shadow-md'
                        : 'bg-[#FFF5F8] text-[#1E1926] border-[#FCE7F3] hover:bg-pink-50'
                    }`}
                  >
                    <span>🌸</span> 3D VRM (LUCY 3D)
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAvatarEngine('live2d');
                      emitCrossWindow(AVATAR_CONFIGURATION_CHANGED, { avatarEngine: 'live2d' });
                      emitCrossWindow('lucy-settings-changed');
                    }}
                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      avatarEngine === 'live2d'
                        ? 'bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white border-pink-500 shadow-md'
                        : 'bg-[#FFF5F8] text-[#1E1926] border-[#FCE7F3] hover:bg-pink-50'
                    }`}
                  >
                    <span>✨</span> Live2D Engine
                  </button>
                </div>

                {/* Live2D Model Selection Grid */}
                {avatarEngine === 'live2d' && (
                  <div className="flex flex-col gap-2 pt-2 border-t border-[#FCE7F3]">
                    <span className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider">Select Live2D Companion</span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {LIVE2D_MODELS.map((m) => {
                        const isSelected = selectedLive2dModel === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setAvatarEngine('live2d');
                              setSelectedLive2dModel(m.id);
                              emitCrossWindow(AVATAR_CONFIGURATION_CHANGED, {
                                avatarEngine: 'live2d',
                                selectedLive2dModel: m.id,
                              });
                              emitCrossWindow('lucy-settings-changed');
                            }}
                            className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-pink-50 border-pink-500 text-pink-700 shadow-sm ring-2 ring-pink-400/30'
                                : 'bg-white border-[#FCE7F3] hover:border-pink-300 text-[#1E1926]'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xl">{m.icon}</span>
                              <span className="font-bold text-xs">{m.name}</span>
                            </div>
                            <span className="text-[10px] text-[#6B7280]">{m.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Auto-Start Microphone Toggle */}
              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex items-center justify-between transition-colors">
                <div>
                  <label className="block text-sm font-bold text-[#1E1926]">Auto-Start Microphone</label>
                  <p className="text-xs text-[#6B7280] mt-0.5">If enabled, LUCY will automatically start listening the moment you open the app.</p>
                </div>
                <button
                  onClick={() => handleAutoMicChange(!autoMic)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${autoMic ? 'bg-[#F43F8E]' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${autoMic ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Avatar Lock Toggle */}
              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex items-center justify-between transition-colors">
                <div>
                  <label className="block text-sm font-bold text-[#1E1926]">Lock Avatar Position</label>
                  <p className="text-xs text-[#6B7280] mt-0.5">Keep the avatar in its current spot. It won't wander around but will still pose and peek.</p>
                </div>
                <button
                  onClick={() => handleAvatarLockedChange(!avatarLocked)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${avatarLocked ? 'bg-[#F43F8E]' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${avatarLocked ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Avatar Size Slider */}
              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 transition-colors">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-bold text-[#1E1926]">Avatar Size</label>
                  <span className="text-sm font-mono font-bold text-[#F43F8E]">{avatarSize}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="200"
                  value={avatarSize}
                  onChange={(e) => handleAvatarSizeChange(parseInt(e.target.value))}
                  className="w-full h-2 bg-pink-100 rounded-lg appearance-none cursor-pointer accent-[#F43F8E] mt-2"
                />
                <div className="flex justify-between text-xs text-[#6B7280] mt-2">
                  <span>50%</span>
                  <span>100% (Default)</span>
                  <span>200%</span>
                </div>
              </div>

              {/* Dynamic Talking Mode Toggle */}
              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex items-center justify-between transition-colors">
                <div>
                  <label className="block text-sm font-bold text-[#1E1926]">Dynamic Talking Mode (Desktop Mate Style)</label>
                  <p className="text-xs text-[#6B7280] mt-0.5">When speaking, LUCY dynamically anchors to the taskbar with a large face and highly flexible talking poses.</p>
                </div>
                <button
                  onClick={() => {
                    const val = !useAvatarState.getState().isDynamicTalkingEnabled;
                    useAvatarState.getState().setDynamicTalkingEnabled(val);
                    localStorage.setItem('lucy_dynamic_talking', String(val));
                    logger.add('info', 'Settings', `Dynamic Talking Mode set to ${val}`);
                  }}
                  className={`relative w-12 h-6 rounded-full transition-colors ${useAvatarState.getState().isDynamicTalkingEnabled ? 'bg-[#F43F8E]' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${useAvatarState.getState().isDynamicTalkingEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

            </div>
          </div>
        )}

        {activeTab === 'devices' && (
          <div className="flex flex-col gap-6 max-w-2xl w-full">
            <div>
              <h3 className="text-2xl font-black mb-1 text-[#1E1926]">Hardware Devices</h3>
              <p className="text-[#6B7280] text-xs mb-4">Select your preferred audio and video inputs for LUCY.</p>
            </div>

            <div className="flex flex-col gap-4">
              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-pink-50 text-[#F43F8E]">
                    <Mic className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-[#1E1926]">Microphone Input</h4>
                    <p className="text-xs text-[#6B7280]">Select your preferred audio input device</p>
                  </div>
                </div>
                
                <select 
                  value={micId}
                  onChange={(e) => handleMicChange(e.target.value)}
                  className="bg-[#FFF5F8] border border-[#FCE7F3] text-[#1E1926] rounded-xl p-3 text-sm focus:outline-none focus:border-[#F43F8E] transition-colors w-full"
                >
                  <option value="default">System Default</option>
                  {devices.filter(d => d.kind === 'audioinput').map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || 'Unknown Microphone'}</option>
                  ))}
                </select>

                <div className="pt-3 border-t border-pink-100 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[#1E1926]">Microphone Sensitivity Boost</label>
                    <span className="text-xs font-bold text-[#F43F8E]">
                      {micBoost.toFixed(1)}x {micBoost >= 2.0 ? '(Low Voice Boost Active)' : '(Normal)'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="4.0"
                    step="0.2"
                    value={micBoost}
                    onChange={(e) => handleMicBoostChange(parseFloat(e.target.value))}
                    className="w-full accent-[#F43F8E] cursor-pointer"
                  />
                  <p className="text-[11px] text-[#6B7280]">
                    Increase this slider if Lucy has trouble hearing you when you speak softly or quietly. Recommended: 2.0x – 2.6x.
                  </p>
                </div>
              </div>

              {/* Acoustic Echo Shield Status */}
              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex items-center justify-between transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <label className="block text-sm font-bold text-[#1E1926]">Acoustic Echo Shield</label>
                    <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-green-100 text-green-700">
                      Always Active
                    </span>
                  </div>
                  <p className="text-xs text-[#6B7280] mt-0.5">
                    Microphone feedback is dynamically gated while Lucy is speaking and during room reverberation, ensuring she never listens or replies to her own voice.
                  </p>
                </div>
              </div>

              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-purple-50 text-[#8B5CF6]">
                    <Video className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-[#1E1926]">Camera Input</h4>
                    <p className="text-xs text-[#6B7280]">Select your preferred camera device</p>
                  </div>
                </div>
                
                <select 
                  value={camId}
                  onChange={(e) => handleCamChange(e.target.value)}
                  className="bg-[#FFF5F8] border border-[#FCE7F3] text-[#1E1926] rounded-xl p-3 text-sm focus:outline-none focus:border-[#8B5CF6] transition-colors w-full"
                >
                  <option value="default">System Default</option>
                  {devices.filter(d => d.kind === 'videoinput').map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || 'Unknown Camera'}</option>
                  ))}
                </select>
              </div>

              {/* Permissions & Automation Guide */}
              {(isMac || isLinux) && (
                <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex flex-col gap-4 mt-2">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
                      <SettingsIcon className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-[#1E1926]">System Permissions &amp; Automation</h4>
                      <p className="text-xs text-[#6B7280]">Required for seamless background AI actions</p>
                    </div>
                  </div>

                  {isMac && (
                    <div className="bg-[#FFF5F8] rounded-xl p-4 mt-2 border border-[#FCE7F3]">
                      <h5 className="font-bold text-[#F43F8E] mb-2 text-sm">macOS Setup Required:</h5>
                      <p className="text-xs text-[#6B7280] mb-2">To allow the AI to automate tasks, take screenshots, and use the camera, you must grant permissions:</p>
                      <ol className="text-xs text-[#6B7280] list-decimal pl-5 space-y-1">
                        <li>Open <strong className="text-[#1E1926]">System Settings</strong> {'>'} <strong className="text-[#1E1926]">Privacy &amp; Security</strong></li>
                        <li>Under <strong className="text-[#1E1926]">Accessibility</strong>, enable LUCY (for mouse/keyboard control).</li>
                        <li>Under <strong className="text-[#1E1926]">Screen Recording</strong>, enable LUCY.</li>
                        <li>Under <strong className="text-[#1E1926]">Camera &amp; Microphone</strong>, enable LUCY when prompted.</li>
                      </ol>
                    </div>
                  )}

                  {isLinux && (
                    <div className="bg-[#FFF5F8] rounded-xl p-4 mt-2 border border-[#FCE7F3]">
                      <h5 className="font-bold text-[#F43F8E] mb-2 text-sm">Linux Wayland Support:</h5>
                      <p className="text-xs text-[#6B7280] mb-4">If you are using Wayland, standard automation may fail. LUCY can use <code className="bg-white px-1 py-0.5 rounded border border-[#FCE7F3] text-[#1E1926]">ydotool</code> as a fallback.</p>
                      <button 
                        onClick={handleSetupWayland}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-xs transition-colors font-bold shadow-sm"
                      >
                        Setup Wayland Automation (Requires Sudo)
                      </button>
                      <p className="text-xs text-[#6B7280] mt-3">This will prompt for your password to run `pkexec ydotoold` to start the background automation daemon.</p>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5">
                 <div className="flex items-center gap-4 mb-3">
                   <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
                     <Volume2 className="w-6 h-6" />
                   </div>
                   <div>
                     <h4 className="text-base font-bold text-[#1E1926]">Audio Output</h4>
                     <p className="text-xs text-[#6B7280]">Playback device configuration</p>
                   </div>
                 </div>
                 <p className="text-xs text-[#6B7280] bg-[#FFF5F8] p-4 rounded-xl border border-[#FCE7F3]">
                   Output currently uses your system's default audio device. Volume can be controlled via the Windows Volume Mixer.
                 </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'wake-test' && <WakeWordTestPage deviceId={micId} />}

        {activeTab === 'link' && (
          <PhoneLinkTab />
        )}

        {activeTab === 'api' && (
          <div className="flex flex-col gap-6 max-w-2xl w-full">
            <div>
              <h3 className="text-2xl font-black mb-1 text-[#1E1926]">AI &amp; API Keys</h3>
              <p className="text-[#6B7280] text-xs mb-4">Configure AI models, voice characters, and provider keys for LUCY.</p>
            </div>

            <div className="flex flex-col gap-4">
              {/* Voice and Model */}
              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-[#1E1926] flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#F43F8E]" /> Gemini Live AI Model
                  </label>
                  <select 
                    value={model}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="bg-[#FFF5F8] border border-[#FCE7F3] text-[#1E1926] rounded-xl p-3 text-sm focus:outline-none focus:border-[#F43F8E] transition-colors"
                  >
                    <option value="gemini-3.1-flash-live-preview">gemini-3.1-flash-live-preview (Voice · Live Preview)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-bold text-[#1E1926] flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-[#F43F8E]" /> Assistant Voice
                  </label>
                  <select 
                    value={voice}
                    onChange={(e) => handleVoiceChange(e.target.value)}
                    className="bg-[#FFF5F8] border border-[#FCE7F3] text-[#1E1926] rounded-xl p-3 text-sm focus:outline-none focus:border-[#F43F8E] transition-colors"
                  >
                    <option value="Aoede">Aoede</option>
                    <option value="Puck">Puck</option>
                    <option value="Charon">Charon</option>
                    <option value="Kore">Kore</option>
                    <option value="Fenrir">Fenrir</option>
                  </select>
                </div>
              </div>

              {/* Personality Textarea */}
              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5">
                <label className="block text-sm font-bold text-[#1E1926] mb-2">Personality &amp; Custom Preferences</label>
                <textarea
                  value={systemInstruction}
                  onChange={(e) => handleInstructionChange(e.target.value)}
                  rows={4}
                  className="w-full bg-[#FFF5F8] text-[#1E1926] text-sm border border-[#FCE7F3] rounded-xl p-3 outline-none focus:border-[#F43F8E] font-sans resize-none"
                  placeholder="E.g., You love making sarcastic jokes and speaking sweetly..."
                />
                <p className="text-xs text-[#6B7280] mt-2">These instructions add custom personality quirks and preferences on top of LUCY's core automation system.</p>
              </div>

              {/* Keys */}
              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex flex-col gap-5">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-bold text-[#1E1926]">Main Gemini API Key</label>
                    <button
                      type="button"
                      onClick={() => openExternalUrl('https://aistudio.google.com/app/apikey')}
                      className="text-xs text-[#F43F8E] hover:text-[#E11D48] font-bold flex items-center gap-1 hover:underline cursor-pointer bg-pink-50 px-2.5 py-1 rounded-lg border border-pink-200 transition-all"
                    >
                      Get Gemini API Key <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  <input
                    type="password"
                    value={mainApiKey}
                    onChange={(e) => handleMainApiKeyChange(e.target.value)}
                    className="w-full bg-[#FFF5F8] text-[#1E1926] text-sm border border-[#FCE7F3] rounded-xl p-3 outline-none focus:border-[#F43F8E] font-sans"
                    placeholder="AIzaSy..."
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-bold text-[#1E1926]">Alternative Gemini API Key</label>
                    <button
                      type="button"
                      onClick={() => openExternalUrl('https://aistudio.google.com/app/apikey')}
                      className="text-xs text-[#F43F8E] hover:text-[#E11D48] font-bold flex items-center gap-1 hover:underline cursor-pointer bg-pink-50 px-2.5 py-1 rounded-lg border border-pink-200 transition-all"
                    >
                      Get Gemini API Key <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  <input
                    type="password"
                    value={altApiKey}
                    onChange={(e) => handleAltApiKeyChange(e.target.value)}
                    className="w-full bg-[#FFF5F8] text-[#1E1926] text-sm border border-[#FCE7F3] rounded-xl p-3 outline-none focus:border-[#F43F8E] font-sans"
                    placeholder="AIzaSy..."
                  />
                  <p className="text-xs text-[#6B7280] mt-1">Fallback API key if the main key hits a rate limit.</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-bold text-[#1E1926]">Tavily Search API Key</label>
                    <button
                      type="button"
                      onClick={() => openExternalUrl('https://tavily.com')}
                      className="text-xs text-[#F43F8E] hover:text-[#E11D48] font-bold flex items-center gap-1 hover:underline cursor-pointer bg-pink-50 px-2.5 py-1 rounded-lg border border-pink-200 transition-all"
                    >
                      Get Tavily API Key <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                  <input
                    type="password"
                    value={tavilyApiKey}
                    onChange={(e) => handleTavilyApiKeyChange(e.target.value)}
                    className="w-full bg-[#FFF5F8] text-[#1E1926] text-sm border border-[#FCE7F3] rounded-xl p-3 outline-none focus:border-[#F43F8E] font-sans"
                    placeholder="tvly-dev-..."
                  />
                </div>
              </div>

            </div>
          </div>
        )}

        {activeTab === 'shortcuts' && (
          <div className="flex flex-col gap-6 max-w-2xl w-full">
            <div>
              <h3 className="text-2xl font-black mb-1 text-[#1E1926]">Global Shortcuts</h3>
              <p className="text-[#6B7280] text-xs mb-4">These shortcuts work globally across your operating system.</p>
            </div>
            
            <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between pb-4 border-b border-[#FCE7F3]">
                <div>
                  <h4 className="text-base font-bold text-[#1E1926]">Toggle Speaker</h4>
                  <p className="text-xs text-[#6B7280]">Mute or unmute LUCY's spoken responses</p>
                </div>
                <kbd className="bg-[#FFF5F8] border border-[#FCE7F3] rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-[#F43F8E] shadow-sm">Ctrl + Alt + S</kbd>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-bold text-[#1E1926]">Toggle Microphone</h4>
                  <p className="text-xs text-[#6B7280]">Turn the microphone on or off</p>
                </div>
                <kbd className="bg-[#FFF5F8] border border-[#FCE7F3] rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-[#F43F8E] shadow-sm">Ctrl + Alt + M</kbd>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'assets' && (
           <AssetLibrary />
        )}

        {activeTab === 'personalized' && (
          <div className="flex flex-col gap-6 max-w-2xl w-full">
            <div>
              <h3 className="text-2xl font-black mb-1 text-[#1E1926]">Personalized Memory</h3>
              <p className="text-[#6B7280] text-xs mb-4">LUCY's invisible brain. The AI silently extracts and saves important facts about you from your conversations to personalize future interactions.</p>
            </div>
            
            {!userAuth.isPro() ? (
              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-8 text-center flex flex-col items-center justify-center gap-4 relative overflow-hidden">
                <div className="w-14 h-14 rounded-2xl bg-pink-50 border border-[#FCE7F3] flex items-center justify-center text-[#F43F8E] text-2xl shadow-sm">
                  🔒
                </div>
                <div>
                  <h4 className="text-lg font-bold text-[#1E1926] mb-1">Personalized Memory is a Pro Feature</h4>
                  <p className="text-[#6B7280] text-xs max-w-md leading-relaxed">
                    LUCY silently collects and saves your preferences for free in the background. Upgrade to Pro to view your memory bank, edit facts, and allow LUCY to recall them in real-time conversations!
                  </p>
                </div>
                <button 
                  onClick={() => openExternalUrl('https://lucymate.vercel.app/pricing')}
                  className="mt-2 px-6 py-2.5 bg-gradient-to-r from-[#F43F8E] to-[#8B5CF6] hover:opacity-95 text-white font-bold rounded-xl shadow-md transition-all text-xs cursor-pointer"
                >
                  Upgrade to Pro ($2 / ₹199)
                </button>
              </div>
            ) : (
              <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-6">
                {memories.length === 0 ? (
                  <p className="text-[#6B7280] text-sm italic">No memories saved yet. Talk to LUCY naturally, and she will silently remember important details about you!</p>
                ) : (
                  <div className="space-y-3">
                    {memories.map(m => (
                      <div key={m.id} className="flex items-start justify-between bg-[#FFF5F8] p-4 rounded-xl border border-[#FCE7F3] gap-4">
                        <div className="flex flex-col gap-1">
                          <p className="text-[#1E1926] text-sm font-medium leading-relaxed">{m.text}</p>
                          <p className="text-[#6B7280] text-xs">{new Date(m.createdAt).toLocaleString()}</p>
                        </div>
                        <button 
                          onClick={() => vectorMemory.deleteMemory(m.id)} 
                          className="text-[#F43F8E] hover:text-[#E11D48] text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-[#FCE7F3] hover:bg-[#FCE7F3] shrink-0 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'about' && (
          <div className="flex flex-col gap-6 max-w-2xl w-full">
            <div>
              <h3 className="text-2xl font-black mb-1 text-[#1E1926]">About LUCY AI</h3>
              <p className="text-[#6B7280] text-xs mb-4">Ecosystem specifications, version status, and official project links.</p>
            </div>

            {/* App Branding Card */}
            <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-[#FCE7F3] shadow-md shadow-pink-500/10 shrink-0">
                  <img src="/lucy-logo.png" alt="LUCY Logo" className="w-full h-full object-cover" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-lg font-black text-[#1E1926]">LUCY AI</h4>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 text-[10px] font-extrabold tracking-wide">
                      v2.0.0
                    </span>
                  </div>
                  <p className="text-xs text-[#6B7280] mt-0.5">Autonomous Desktop Companion &amp; Multimodal Voice Assistant</p>
                  <p className="text-[11px] text-[#9CA3AF] mt-1 font-mono">Build: com.lucy.mate (x64 Windows Release)</p>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <button
                  onClick={async () => {
                    setIsCheckingUpdate(true);
                    setUpdateStatusMsg('Checking with lucymate.vercel.app…');
                    const info = await checkAppUpdate();
                    setIsCheckingUpdate(false);
                    if (info && info.updateAvailable) {
                      setUpdateInfo(info);
                      setUpdateStatusMsg(`Update v${info.version} available!`);
                    } else {
                      setUpdateStatusMsg('You are running the latest version (v2.0.0).');
                    }
                    setTimeout(() => setUpdateStatusMsg(null), 4000);
                  }}
                  disabled={isCheckingUpdate}
                  className="px-4 py-2 bg-[#FFF5F8] border border-[#FCE7F3] hover:border-[#F43F8E] text-[#F43F8E] text-xs font-bold rounded-xl flex items-center gap-2 transition-all shadow-xs cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                  {isCheckingUpdate ? 'Checking…' : 'Check for Updates'}
                </button>
                {updateStatusMsg && (
                  <span className="text-[11px] text-emerald-600 font-semibold">{updateStatusMsg}</span>
                )}
              </div>
            </div>

            {/* Technical Specifications */}
            <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-6 flex flex-col gap-3">
              <h4 className="text-xs font-bold text-[#1E1926] uppercase tracking-wider mb-1">Architecture &amp; Engine Stack</h4>
              
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-[#FFF5F8] rounded-xl border border-[#FCE7F3]">
                  <p className="font-bold text-[#1E1926]">AI Model Engine</p>
                  <p className="text-[#6B7280] mt-0.5">Google {model} (Bi-directional PCM 16kHz WebSocket)</p>
                </div>
                <div className="p-3 bg-[#FFF5F8] rounded-xl border border-[#FCE7F3]">
                  <p className="font-bold text-[#1E1926]">3D Avatar Rendering</p>
                  <p className="text-[#6B7280] mt-0.5">Three.js VRM Humanoid 2.0 with Real-Time Audio Viseme Morphing</p>
                </div>
                <div className="p-3 bg-[#FFF5F8] rounded-xl border border-[#FCE7F3]">
                  <p className="font-bold text-[#1E1926]">Desktop Architecture</p>
                  <p className="text-[#6B7280] mt-0.5">Tauri 2.0 (Native Rust Engine + WebView2 Chromium Layer)</p>
                </div>
                <div className="p-3 bg-[#FFF5F8] rounded-xl border border-[#FCE7F3]">
                  <p className="font-bold text-[#1E1926]">Sign-in Flow</p>
                  <p className="text-[#6B7280] mt-0.5">Browser sign-in with a secure session check</p>
                </div>
              </div>
            </div>

            {/* Official Project & Support Links */}
            <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-6 flex flex-col gap-3">
              <h4 className="text-xs font-bold text-[#1E1926] uppercase tracking-wider mb-1">Official Links &amp; Support</h4>
              
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1 border-b border-[#FCE7F3]">
                  <span className="text-[#6B7280]">Official Cloud Portal</span>
                  <button 
                    onClick={() => openExternalUrl('https://lucymate.vercel.app')}
                    className="text-[#F43F8E] font-bold hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    lucymate.vercel.app <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-[#FCE7F3]">
                  <span className="text-[#6B7280]">Support &amp; Inquiries</span>
                  <a href="mailto:mail@satish.com.np" className="text-[#F43F8E] font-bold hover:underline">
                    mail@satish.com.np
                  </a>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-[#FCE7F3]">
                  <span className="text-[#6B7280]">Developer</span>
                  <span className="font-semibold text-[#1E1926]">Satish Acharya</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-[#6B7280]">Terms of Service &amp; Privacy</span>
                  <button 
                    onClick={() => openExternalUrl('https://lucymate.vercel.app/terms')}
                    className="text-[#F43F8E] font-semibold hover:underline cursor-pointer"
                  >
                    View Terms &amp; Policies
                  </button>
                </div>
              </div>
            </div>

            {/* What's New in v2.0.0 */}
            <div className="bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-indigo-500/10 border border-pink-200 rounded-2xl p-6 shadow-xs">
              <h4 className="text-xs font-bold text-[#1E1926] uppercase tracking-wider mb-2">What&apos;s New in v2.0.0</h4>
              <ul className="text-xs text-[#6B7280] space-y-1.5 list-disc pl-4">
                <li>Complete LUCY luxury rebranding with pearl-pink color palette.</li>
                <li>Simplified browser sign-in with secure session verification.</li>
                <li>Auto-enabled microphone and audio playback with no browser permission pop-ups.</li>
                <li>Brand new luxury chat interface with avatar badges, prompt chips, and copy support.</li>
                <li>Official high-resolution Android launcher icon ported to Windows desktop.</li>
              </ul>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

type WakeScore = { phrase: 'Lucy' | 'Hey Lucy'; score: number; smoothed: number };
type WakeTrial = { successes: number; attempts: number; triggers: number; latest: number };

function WakeWordTestPage({ deviceId }: { deviceId: string }) {
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [status, setStatus] = useState('Ready to test');
  const [scores, setScores] = useState<Record<WakeScore['phrase'], number[]>>({ Lucy: [], 'Hey Lucy': [] });
  const [latest, setLatest] = useState<Record<WakeScore['phrase'], number>>({ Lucy: 0, 'Hey Lucy': 0 });
  const [trials, setTrials] = useState<Record<WakeScore['phrase'], WakeTrial>>({
    Lucy: { successes: 0, attempts: 0, triggers: 0, latest: 0 },
    'Hey Lucy': { successes: 0, attempts: 0, triggers: 0, latest: 0 },
  });

  useEffect(() => {
    let disposed = false;
    let unlistenScore: UnlistenFn | undefined;
    let unlistenDetected: UnlistenFn | undefined;
    let unlistenError: UnlistenFn | undefined;
    let unlistenStatus: UnlistenFn | undefined;

    void listen<WakeScore>('native-wake-test-score', ({ payload }) => {
      const phrase = payload.phrase;
      if (phrase !== 'Lucy' && phrase !== 'Hey Lucy') return;
      const value = Math.max(0, Math.min(1, payload.smoothed || payload.score || 0));
      setLatest(current => ({ ...current, [phrase]: value }));
      setScores(current => ({ ...current, [phrase]: [...current[phrase].slice(-59), value] }));
    }).then(unlisten => { if (disposed) unlisten(); else unlistenScore = unlisten; });

    void listen<string>('native-wake-test-detected', ({ payload }) => {
      if (payload !== 'Lucy' && payload !== 'Hey Lucy') return;
      setTrials(current => ({ ...current, [payload]: { ...current[payload], triggers: current[payload].triggers + 1 } }));
      setStatus(`Detector triggered: ${payload}`);
    }).then(unlisten => { if (disposed) unlisten(); else unlistenDetected = unlisten; });

    void listen<string>('native-wake-error', ({ payload }) => {
      setStatus(`Microphone test error: ${payload}`);
      setRunning(false);
      runningRef.current = false;
    }).then(unlisten => { if (disposed) unlisten(); else unlistenError = unlisten; });

    void listen<string>('native-wake-status', ({ payload }) => {
      if (payload === 'stopped' && runningRef.current) {
        setRunning(false);
        runningRef.current = false;
        setStatus('Test stopped');
      }
    }).then(unlisten => { if (disposed) unlisten(); else unlistenStatus = unlisten; });

    return () => {
      disposed = true;
      unlistenScore?.();
      unlistenDetected?.();
      unlistenError?.();
      unlistenStatus?.();
      if (runningRef.current) {
        void invoke('stop_native_wake_listener').catch(() => {});
        if (useAvatarState.getState().isSleepMode) {
          void invoke('start_native_wake_listener', { deviceId: localStorage.getItem('lucy_mic_id') || 'default' }).catch(() => {});
        }
      }
    };
  }, []);

  const start = async () => {
    try {
      setStatus('Stopping other audio listeners…');
      // Turn off microphone for the assistant / live engine across windows
      await emitCrossWindow('lucy-set-mic', { enabled: false });
      // Stop any active native mic capture and background wake listener
      await invoke('stop_native_mic').catch(() => {});
      await invoke('stop_native_wake_listener').catch(() => {});

      setStatus('Starting local model test…');
      await invoke('start_native_wake_test', { deviceId });
      runningRef.current = true;
      setRunning(true);
      setStatus('Listening. Say "Lucy" or "Hey Lucy" to test recognition.');
    } catch (error) {
      setStatus(`Could not start test: ${String(error)}`);
    }
  };

  const stop = async () => {
    try {
      await invoke('stop_native_wake_listener');
      runningRef.current = false;
      setRunning(false);
      setStatus('Test stopped');
      if (useAvatarState.getState().isSleepMode) {
        await invoke('start_native_wake_listener', { deviceId });
      }
    } catch (error) {
      setStatus(`Could not stop test: ${String(error)}`);
    }
  };

  const recordTrial = (phrase: WakeScore['phrase'], success: boolean) => {
    setTrials(current => ({
      ...current,
      [phrase]: { ...current[phrase], attempts: current[phrase].attempts + 1, successes: current[phrase].successes + (success ? 1 : 0) },
    }));
  };

  const reset = () => {
    setScores({ Lucy: [], 'Hey Lucy': [] });
    setLatest({ Lucy: 0, 'Hey Lucy': 0 });
    setTrials({ Lucy: { successes: 0, attempts: 0, triggers: 0, latest: 0 }, 'Hey Lucy': { successes: 0, attempts: 0, triggers: 0, latest: 0 } });
    setStatus(running ? 'Listening. Say one wake phrase, then record whether it recognized you.' : 'Ready to test');
  };

  const scoreLine = (values: number[]) => values.map((value, index) => `${values.length < 2 ? 0 : index / (values.length - 1) * 240},${70 - value * 65}`).join(' ');

  return (
    <div className="flex flex-col gap-5 max-w-4xl w-full">
      <div>
        <h3 className="text-2xl font-black mb-1 text-[#1E1926]">Wake Word Test</h3>
        <p className="text-[#6B7280] text-xs">Live model confidence and your recorded recognition rate for “Lucy” and “Hey Lucy”. The score is a model signal, not a guaranteed accuracy percentage.</p>
      </div>
      <div className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><span className={`w-2.5 h-2.5 rounded-full ${running ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} /><div><div className="text-sm font-bold">{running ? 'Test microphone active' : 'Test microphone stopped'}</div><div className="text-xs text-[#6B7280] mt-0.5">{status}</div></div></div>
        <div className="flex gap-2">{running ? <button onClick={() => void stop()} className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold flex items-center gap-2"><Square className="w-3.5 h-3.5" /> Stop test</button> : <button onClick={() => void start()} className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#F43F8E] to-[#E11D48] text-white text-xs font-bold flex items-center gap-2"><Play className="w-3.5 h-3.5" /> Start test</button>}<button onClick={reset} className="px-3 py-2 rounded-xl border border-[#FCE7F3] text-[#6B7280] text-xs font-bold flex items-center gap-2"><RotateCcw className="w-3.5 h-3.5" /> Reset</button></div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {(['Lucy', 'Hey Lucy'] as const).map(phrase => {
          const trial = trials[phrase];
          const recall = trial.attempts ? Math.round(trial.successes / trial.attempts * 100) : 0;
          const line = scoreLine(scores[phrase]);
          return <div key={phrase} className="bg-white border border-[#FCE7F3] shadow-sm rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between"><div><h4 className="text-lg font-extrabold">{phrase}</h4><p className="text-[11px] text-[#6B7280]">{phrase === 'Lucy' ? 'Lucy model' : 'Hey Lucy model'}</p></div><div className="text-right"><div className="text-2xl font-black text-[#E11D48]">{Math.round(latest[phrase] * 100)}%</div><div className="text-[10px] text-[#6B7280]">current score</div></div></div>
            <div className="bg-[#FFF7FA] border border-[#FCE7F3] rounded-xl p-3"><div className="flex justify-between text-[10px] text-[#6B7280] mb-1.5"><span>Confidence history</span><span>{scores[phrase].length} samples</span></div><svg viewBox="0 0 240 70" className="w-full h-20 overflow-visible" role="img" aria-label={`${phrase} model confidence graph`}><line x1="0" y1="37.5" x2="240" y2="37.5" stroke="#fbcfe8" strokeDasharray="3 4"/><polyline fill="none" stroke="#e11d48" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={line}/></svg><div className="flex justify-between text-[9px] text-[#9CA3AF]"><span>Low</span><span>Trigger region ≈ 50%</span><span>High</span></div></div>
            <div><div className="flex justify-between text-xs mb-1.5"><span className="font-bold">Your recognition rate</span><span>{trial.successes}/{trial.attempts} · {trial.attempts ? `${recall}%` : 'not measured'}</span></div><div className="h-2 rounded-full bg-pink-100 overflow-hidden"><div className="h-full bg-gradient-to-r from-[#F43F8E] to-[#E11D48] transition-all" style={{ width: `${recall}%` }}/></div><div className="text-[10px] text-[#6B7280] mt-2">Model triggers observed: {trial.triggers}</div></div>
            <div className="grid grid-cols-2 gap-2"><button disabled={!running} onClick={() => recordTrial(phrase, true)} className="disabled:opacity-40 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold flex items-center justify-center gap-1.5"><Check className="w-3.5 h-3.5"/>Recognized me</button><button disabled={!running} onClick={() => recordTrial(phrase, false)} className="disabled:opacity-40 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-bold flex items-center justify-center gap-1.5"><X className="w-3.5 h-3.5"/>Missed phrase</button></div>
          </div>;
        })}
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-[11px] text-amber-900"><strong>How to measure:</strong> start the test, say each phrase several times from your usual distance and speaking style, then mark each attempt as recognized or missed. The percentage is your manual hit rate; false triggers from unrelated speech can be counted separately by noting the trigger total. Keep the test active only while using the microphone.</div>
    </div>
  );
}
