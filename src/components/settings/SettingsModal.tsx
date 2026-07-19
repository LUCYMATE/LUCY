import { useState, useEffect } from 'react';
import { X, Settings as SettingsIcon, Volume2, Mic } from 'lucide-react';
import { logger } from '../../lib/store/logger';
import { useAvatarState } from '../../lib/store/avatarState';

interface SettingsModalProps {
  onClose: () => void;
  onSettingsChanged?: () => void;
}

export function SettingsModal({ onClose, onSettingsChanged }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState('general');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>('');
  
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');


  const [selectedVoice, setSelectedVoice] = useState<string>(() => localStorage.getItem('soltini_voice') || 'Aoede');
  const [avatarSize, setAvatarSize] = useState<string>(() => {
    const val = localStorage.getItem('soltini_avatar_size');
    if (!val || ['Small', 'Medium', 'Large'].includes(val)) return '100';
    return val;
  });
  const [systemInstruction, setSystemInstruction] = useState<string>(() => {
    const val = localStorage.getItem('soltini_system_instruction') || '';
    if (val.includes('You are Soltini Ai , a playful and bubbly')) return '';
    return val;
  });
  const [mainApiKey, setMainApiKey] = useState<string>(() => localStorage.getItem('soltini_main_api_key') || '');
  const [altApiKey, setAltApiKey] = useState<string>(() => localStorage.getItem('soltini_alt_api_key') || '');
  const [tavilyApiKey, setTavilyApiKey] = useState<string>(() => localStorage.getItem('soltini_tavily_api_key') || '');
  const [changed, setChanged] = useState(false);
  const [launchPetMode, setLaunchPetMode] = useState<boolean>(
    () => localStorage.getItem('soltini_launch_pet_mode') === 'true'
  );
  const [avatarLocked, setAvatarLocked] = useState<boolean>(
    () => localStorage.getItem('soltini_avatar_locked') === 'true'
  );

  useEffect(() => {
    async function loadDevices() {
      try {
        // Request permissions first to get labels
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        
        // Microphones
        const audioInputs = allDevices.filter(d => d.kind === 'audioinput');
        setDevices(audioInputs);
        const savedMicId = localStorage.getItem('soltini_mic_id');
        if (savedMicId && audioInputs.some(d => d.deviceId === savedMicId)) {
          setSelectedMic(savedMicId);
        } else if (audioInputs.length > 0) {
          setSelectedMic(audioInputs[0].deviceId);
          localStorage.setItem('soltini_mic_id', audioInputs[0].deviceId);
        }

        // Cameras
        const videoInputs = allDevices.filter(d => d.kind === 'videoinput');
        setVideoDevices(videoInputs);
        const savedCamId = localStorage.getItem('soltini_camera_id');
        if (savedCamId && videoInputs.some(d => d.deviceId === savedCamId)) {
          setSelectedCamera(savedCamId);
        } else if (videoInputs.length > 0) {
          setSelectedCamera(videoInputs[0].deviceId);
          localStorage.setItem('soltini_camera_id', videoInputs[0].deviceId);
        }
        
      } catch (e) {
        logger.add('error', 'Settings', 'Failed to enumerate devices: ' + String(e));
      }
    }
    loadDevices();
  }, []);

  const handleMicChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedMic(val);
    localStorage.setItem('soltini_mic_id', val);
    setChanged(true);
    logger.add('success', 'Settings', 'Microphone changed to ' + val);
  };

  const handleCameraChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedCamera(val);
    localStorage.setItem('soltini_camera_id', val);
    setChanged(true);
    logger.add('success', 'Settings', 'Camera changed to ' + val);
  };

  const handleVoiceChange = (val: string) => {
    setSelectedVoice(val);
    localStorage.setItem('soltini_voice', val);
    setChanged(true);
    logger.add('success', 'Settings', 'Voice changed to ' + val);
  };

  const handleInstructionChange = (val: string) => {
    setSystemInstruction(val);
    localStorage.setItem('soltini_system_instruction', val);
    setChanged(true);
  };

  const handleAvatarSizeChange = (val: string) => {
    setAvatarSize(val);
    localStorage.setItem('soltini_avatar_size', val);
    // Update zustand immediately so canvas responds without page reload
    useAvatarState.getState().setAvatarScale(parseFloat(val) / 100);
    setChanged(true);
    logger.add('success', 'Settings', 'Avatar size changed to ' + val);
  };

  const handleMainApiKeyChange = (val: string) => {
    setMainApiKey(val);
    localStorage.setItem('soltini_main_api_key', val);
    setChanged(true);
    window.dispatchEvent(new CustomEvent('soltini-api-key-saved'));
  };

  const handleAltApiKeyChange = (val: string) => {
    setAltApiKey(val);
    localStorage.setItem('soltini_alt_api_key', val);
    setChanged(true);
  };

  const handleTavilyApiKeyChange = (val: string) => {
    setTavilyApiKey(val);
    localStorage.setItem('soltini_tavily_api_key', val);
    setChanged(true);
  };


  const handleClose = () => {
    if (changed) {
      if (onSettingsChanged) {
        onSettingsChanged();
      }
      window.dispatchEvent(new CustomEvent('soltini-settings-changed'));
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass w-full max-w-3xl rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex h-[500px]">
        
        {/* Sidebar */}
        <div className="w-56 bg-black/40 border-r border-white/10 flex flex-col p-6">
          <h2 className="text-2xl font-bold text-white mb-8 flex items-center gap-2">
            <SettingsIcon className="w-6 h-6 text-pink-400" /> Settings
          </h2>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setActiveTab('general')}
              className={`px-4 py-3 rounded-xl text-left text-sm font-medium transition-all duration-200 ${activeTab === 'general' ? 'bg-white/15 text-white shadow-inner' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab('audio')}
              className={`px-4 py-3 rounded-xl text-left text-sm font-medium transition-all duration-200 ${activeTab === 'audio' ? 'bg-white/15 text-white shadow-inner' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
            >
              Devices
            </button>
            <button
              onClick={() => setActiveTab('api')}
              className={`px-4 py-3 rounded-xl text-left text-sm font-medium transition-all duration-200 ${activeTab === 'api' ? 'bg-white/15 text-white shadow-inner' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
            >
              AI & API Keys
            </button>
            <button
              onClick={() => setActiveTab('shortcuts')}
              className={`px-4 py-3 rounded-xl text-left text-sm font-medium transition-all duration-200 ${activeTab === 'shortcuts' ? 'bg-white/15 text-white shadow-inner' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
            >
              Shortcuts
            </button>
          </div>
          <div className="mt-auto">
            <button onClick={handleClose} className="flex items-center gap-2 px-4 py-3 rounded-xl text-left text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-all w-full">
              <X className="w-4 h-4" /> Close Settings
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 flex flex-col overflow-y-auto bg-white/[0.02]">
          {activeTab === 'general' && (
            <div className="text-white animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-6">
              <h3 className="text-2xl font-semibold mb-2">General Settings</h3>

              {/* Launch in Pet Mode Toggle */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-medium text-white">Launch in Pet Mode</label>
                    <p className="text-xs text-white/40 mt-1">If enabled, Soltini opens directly in Pet Mode (fullscreen desktop companion) on every launch.</p>
                  </div>
                  <button
                    onClick={() => {
                      const next = !launchPetMode;
                      setLaunchPetMode(next);
                      localStorage.setItem('soltini_launch_pet_mode', String(next));
                    }}
                    className={`relative w-12 h-6 rounded-full transition-colors ${launchPetMode ? 'bg-pink-500' : 'bg-white/20'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${launchPetMode ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>

              {/* Avatar Lock Toggle */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-medium text-white">Lock Avatar Position</label>
                    <p className="text-xs text-white/40 mt-1">Keep the avatar in its current spot. It won't wander around but will still pose and peek.</p>
                  </div>
                  <button
                    onClick={() => {
                      const next = !avatarLocked;
                      setAvatarLocked(next);
                      localStorage.setItem('soltini_avatar_locked', String(next));
                      useAvatarState.getState().setIsAvatarLocked(next);
                    }}
                    className={`relative w-12 h-6 rounded-full transition-colors ${avatarLocked ? 'bg-pink-500' : 'bg-white/20'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${avatarLocked ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>

              {/* Avatar Size Slider */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-white">Avatar Size</label>
                  <span className="text-sm font-mono text-pink-400">{avatarSize}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="200"
                  value={avatarSize}
                  onChange={(e) => handleAvatarSizeChange(e.target.value)}
                  className="w-full h-2 bg-black/40 rounded-lg appearance-none cursor-pointer accent-pink-500"
                />
                <div className="flex justify-between text-xs text-white/40 mt-2">
                  <span>50%</span>
                  <span>100% (Default)</span>
                  <span>200%</span>
                </div>
                <p className="text-xs text-white/40 mt-3">Adjust the size of the 3D avatar on screen.</p>
              </div>
            </div>
          )}

          {activeTab === 'audio' && (
            <div className="text-white animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors mb-4">
                 <div className="flex items-center gap-4 mb-4">
                   <div className="p-3 rounded-xl bg-pink-500/20 text-pink-400">
                     <Mic className="w-6 h-6" />
                   </div>
                   <div>
                     <h4 className="text-lg font-medium text-white">Microphone Input</h4>
                     <p className="text-sm text-white/50">Select your preferred audio input device</p>
                   </div>
                 </div>
                 
                 <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                   {devices.length === 0 ? (
                     <p className="text-sm text-white/60">Loading devices or no permissions...</p>
                   ) : (
                     <select 
                       value={selectedMic} 
                       onChange={handleMicChange}
                       className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500"
                     >
                       {devices.map(device => (
                         <option key={device.deviceId} value={device.deviceId}>
                           {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                         </option>
                       ))}
                     </select>
                   )}
                 </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors mb-4">
                 <div className="flex items-center gap-4 mb-4">
                   <div className="p-3 rounded-xl bg-purple-500/20 text-purple-400">
                     <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.53 21.34A10.53 10.53 0 0 0 21.34 14.53"></path><path d="m22 22-5.5-5.5"></path><circle cx="11" cy="11" r="8"></circle></svg>
                   </div>
                   <div>
                     <h4 className="text-lg font-medium text-white">Camera Input</h4>
                     <p className="text-sm text-white/50">Select your preferred camera device</p>
                   </div>
                 </div>
                 
                 <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                   {videoDevices.length === 0 ? (
                     <p className="text-sm text-white/60">Loading cameras or no permissions...</p>
                   ) : (
                     <select 
                       value={selectedCamera} 
                       onChange={handleCameraChange}
                       className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500"
                     >
                       {videoDevices.map(device => (
                         <option key={device.deviceId} value={device.deviceId}>
                           {device.label || `Camera ${device.deviceId.slice(0, 5)}...`}
                         </option>
                       ))}
                     </select>
                   )}
                 </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                 <div className="flex items-center gap-4 mb-4">
                   <div className="p-3 rounded-xl bg-blue-500/20 text-blue-400">
                     <Volume2 className="w-6 h-6" />
                   </div>
                   <div>
                     <h4 className="text-lg font-medium text-white">Audio Output</h4>
                     <p className="text-sm text-white/50">Playback device configuration</p>
                   </div>
                 </div>
                 <p className="text-sm text-white/60 bg-black/20 p-4 rounded-xl border border-white/5">
                   Output currently uses your system's default audio device. Volume can be controlled via the Windows Volume Mixer.
                 </p>
              </div>

            </div>
          )}

          {activeTab === 'api' && (
            <div className="text-white animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-6">
              <h3 className="text-2xl font-semibold mb-2">AI Configuration & API Keys</h3>
              
              {/* Personality Textarea */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <label className="block text-sm font-medium text-white mb-2">Personality &amp; Custom Preferences</label>
                <textarea
                  value={systemInstruction}
                  onChange={(e) => handleInstructionChange(e.target.value)}
                  rows={4}
                  className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500 font-sans resize-none"
                  placeholder="E.g., You love making sarcastic jokes, keep answers under 2 sentences, etc."
                />
                <p className="text-xs text-white/40 mt-2">These instructions add custom personality quirks and preferences on top of Soltini's core automation system.</p>
              </div>



              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <label className="block text-sm font-medium text-white mb-2">Main Gemini API Key</label>
                <input
                  type="password"
                  value={mainApiKey}
                  onChange={(e) => handleMainApiKeyChange(e.target.value)}
                  className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500 font-sans"
                  placeholder="AIzaSy..."
                />
                <p className="text-xs text-white/40 mt-2">Your primary Gemini API key. If left blank, the app will try to use the key from the .env file.</p>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <label className="block text-sm font-medium text-white mb-2">Alternative Gemini API Key</label>
                <input
                  type="password"
                  value={altApiKey}
                  onChange={(e) => handleAltApiKeyChange(e.target.value)}
                  className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500 font-sans"
                  placeholder="AIzaSy..."
                />
                <p className="text-xs text-white/40 mt-2">A fallback API key. The system will automatically try to use this key if the main key hits a rate limit or fails to connect.</p>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <label className="block text-sm font-medium text-white mb-2">Tavily Search API Key</label>
                <input
                  type="password"
                  value={tavilyApiKey}
                  onChange={(e) => handleTavilyApiKeyChange(e.target.value)}
                  className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500 font-sans"
                  placeholder="tvly-dev-..."
                />
                <p className="text-xs text-white/40 mt-2">API key used for real-time web searches. If left blank, a default developer key will be used.</p>
              </div>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="text-white animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-6">
              <h3 className="text-2xl font-semibold mb-2">Global Shortcuts</h3>
              <p className="text-sm text-white/60 mb-6">These shortcuts work globally across your OS, even when Soltini is minimized or running in the background.</p>
              
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/10">
                  <div>
                    <h4 className="text-lg font-medium text-white">Toggle Speaker</h4>
                    <p className="text-sm text-white/50">Mute or unmute Soltini's spoken responses</p>
                  </div>
                  <kbd className="bg-black/40 border border-white/20 rounded-md px-3 py-1 text-sm font-mono text-pink-400">Ctrl + Alt + S</kbd>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-lg font-medium text-white">Exit Pet Mode</h4>
                    <p className="text-sm text-white/50">Return to the standard window view</p>
                  </div>
                  <kbd className="bg-black/40 border border-white/20 rounded-md px-3 py-1 text-sm font-mono text-pink-400">Ctrl + Alt + X</kbd>
                </div>

                <div className="flex items-center justify-between pt-4 mt-4 border-t border-white/10">
                  <div>
                    <h4 className="text-lg font-medium text-white">Toggle Microphone</h4>
                    <p className="text-sm text-white/50">Turn the microphone on or off</p>
                  </div>
                  <kbd className="bg-black/40 border border-white/20 rounded-md px-3 py-1 text-sm font-mono text-pink-400">Ctrl + Alt + M</kbd>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
