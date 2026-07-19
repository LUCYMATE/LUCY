import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Box, ArrowLeft, Volume2, Mic, Key, Keyboard, Video, Brain } from 'lucide-react';
import { AssetLibrary } from './AssetLibrary';
import { logger } from '../../lib/store/logger';
import { useAvatarState } from '../../lib/store/avatarState';
import { vectorMemory, MemoryFact } from '../../lib/store/vectorMemory';

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'general' | 'devices' | 'api' | 'shortcuts' | 'assets' | 'personalized'>('general');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [memories, setMemories] = useState<MemoryFact[]>([]);
  
  const [micId, setMicId] = useState(localStorage.getItem('soltini_mic_id') || '');
  const [camId, setCamId] = useState(localStorage.getItem('soltini_camera_id') || '');
  const [voice, setVoice] = useState(localStorage.getItem('soltini_voice') || 'Aoede');
  const [avatarSize, setAvatarSize] = useState(parseInt(localStorage.getItem('soltini_avatar_size') || '100'));
  
  const [launchPetMode, setLaunchPetMode] = useState(localStorage.getItem('soltini_launch_pet_mode') === 'true');
  const [autoMic, setAutoMic] = useState(() => {
    const val = localStorage.getItem('soltini_auto_mic');
    return val === null ? true : val === 'true';
  });
  const [avatarLocked, setAvatarLocked] = useState(localStorage.getItem('soltini_avatar_locked') === 'true');
  
  const [systemInstruction, setSystemInstruction] = useState(() => {
    const val = localStorage.getItem('soltini_system_instruction') || '';
    if (val.includes('You are Soltini AI , a playful and bubbly')) return '';
    return val;
  });
  const [mainApiKey, setMainApiKey] = useState(localStorage.getItem('soltini_main_api_key') || '');
  const [altApiKey, setAltApiKey] = useState(localStorage.getItem('soltini_alt_api_key') || '');
  const [tavilyApiKey, setTavilyApiKey] = useState(localStorage.getItem('soltini_tavily_api_key') || '');

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(() => {
      navigator.mediaDevices.enumerateDevices().then(d => setDevices(d));
    }).catch(e => {
      logger.add('error', 'Settings', 'Failed to enumerate devices');
    });
    
    const loadMemories = () => setMemories(vectorMemory.getMemories());
    loadMemories();
    window.addEventListener('soltini-memory-updated', loadMemories);
    return () => window.removeEventListener('soltini-memory-updated', loadMemories);
  }, []);

  const handleMicChange = (val: string) => {
    setMicId(val);
    localStorage.setItem('soltini_mic_id', val);
    logger.add('success', 'Settings', 'Microphone changed');
    window.dispatchEvent(new CustomEvent('soltini-core-settings-changed'));
  };

  const handleCamChange = (val: string) => {
    setCamId(val);
    localStorage.setItem('soltini_camera_id', val);
    logger.add('success', 'Settings', 'Camera changed');
    window.dispatchEvent(new CustomEvent('soltini-core-settings-changed'));
  };

  const handleVoiceChange = (val: string) => {
    setVoice(val);
    localStorage.setItem('soltini_voice', val);
    logger.add('success', 'Settings', 'Voice changed');
    window.dispatchEvent(new CustomEvent('soltini-core-settings-changed'));
  };

  const handleAvatarSizeChange = (val: number) => {
    setAvatarSize(val);
    localStorage.setItem('soltini_avatar_size', val.toString());
    useAvatarState.getState().setAvatarScale(val / 100);
    logger.add('success', 'Settings', 'Avatar size changed');
    window.dispatchEvent(new CustomEvent('soltini-settings-changed'));
  };

  const handleLaunchPetModeChange = (val: boolean) => {
    setLaunchPetMode(val);
    localStorage.setItem('soltini_launch_pet_mode', String(val));
    logger.add('info', 'Settings', `Launch in Pet Mode set to ${val}`);
  };

  const handleAutoMicChange = (val: boolean) => {
    setAutoMic(val);
    localStorage.setItem('soltini_auto_mic', String(val));
    logger.add('info', 'Settings', `Auto-Start Mic set to ${val}`);
  };

  const handleAvatarLockedChange = (val: boolean) => {
    setAvatarLocked(val);
    localStorage.setItem('soltini_avatar_locked', String(val));
    useAvatarState.getState().setIsAvatarLocked(val);
  };

  const handleInstructionChange = (val: string) => {
    setSystemInstruction(val);
    localStorage.setItem('soltini_system_instruction', val);
    window.dispatchEvent(new CustomEvent('soltini-core-settings-changed'));
  };

  const handleMainApiKeyChange = (val: string) => {
    setMainApiKey(val);
    localStorage.setItem('soltini_main_api_key', val);
    window.dispatchEvent(new CustomEvent('soltini-api-key-saved'));
    window.dispatchEvent(new CustomEvent('soltini-core-settings-changed'));
  };

  const handleAltApiKeyChange = (val: string) => {
    setAltApiKey(val);
    localStorage.setItem('soltini_alt_api_key', val);
    window.dispatchEvent(new CustomEvent('soltini-core-settings-changed'));
  };

  const handleTavilyApiKeyChange = (val: string) => {
    setTavilyApiKey(val);
    localStorage.setItem('soltini_tavily_api_key', val);
    window.dispatchEvent(new CustomEvent('soltini-core-settings-changed'));
  };

  return (
    <div className="flex w-full h-full glass rounded-[40px] overflow-hidden text-white animate-in slide-in-from-bottom-10 fade-in duration-500">
      
      {/* Sidebar Navigation */}
      <div className="w-64 bg-black/40 border-r border-white/5 p-6 flex flex-col gap-6 shrink-0">
        <button 
          onClick={onClose}
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors self-start px-2 py-1 -ml-2 rounded-lg hover:bg-white/5"
        >
          <ArrowLeft className="w-4 h-4" /> Back to System
        </button>

        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>

        <nav className="flex flex-col gap-2">
          <button 
            onClick={() => setActiveTab('general')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-medium ${
              activeTab === 'general' ? 'bg-pink-500 text-white' : 'hover:bg-white/10 text-white/70'
            }`}
          >
            <SettingsIcon className="w-5 h-5" /> General
          </button>
          
          <button 
            onClick={() => setActiveTab('devices')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-medium ${
              activeTab === 'devices' ? 'bg-pink-500 text-white' : 'hover:bg-white/10 text-white/70'
            }`}
          >
            <Volume2 className="w-5 h-5" /> Devices
          </button>

          <button 
            onClick={() => setActiveTab('api')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-medium ${
              activeTab === 'api' ? 'bg-pink-500 text-white' : 'hover:bg-white/10 text-white/70'
            }`}
          >
            <Key className="w-5 h-5" /> AI & API Keys
          </button>

          <button 
            onClick={() => setActiveTab('assets')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-medium ${
              activeTab === 'assets' ? 'bg-pink-500 text-white' : 'hover:bg-white/10 text-white/70'
            }`}
          >
            <Box className="w-5 h-5" /> Asset Library
          </button>

          <button 
            onClick={() => setActiveTab('personalized')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-medium ${
              activeTab === 'personalized' ? 'bg-pink-500 text-white' : 'hover:bg-white/10 text-white/70'
            }`}
          >
            <Brain className="w-5 h-5" /> Personalized
          </button>
          
          <button 
            onClick={() => setActiveTab('shortcuts')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left font-medium ${
              activeTab === 'shortcuts' ? 'bg-pink-500 text-white' : 'hover:bg-white/10 text-white/70'
            }`}
          >
            <Keyboard className="w-5 h-5" /> Shortcuts
          </button>
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-12">
        
        {activeTab === 'general' && (
          <div className="flex flex-col gap-8 max-w-2xl w-full">
            <div>
              <h3 className="text-2xl font-bold mb-2">General Configuration</h3>
              <p className="text-white/60 text-sm mb-6">Customize display sizes and window behavior.</p>
            </div>

            <div className="flex flex-col gap-6">
              
              {/* Auto-Start Microphone Toggle */}
              <div className="bg-black/20 border border-white/5 rounded-2xl p-6 flex items-center justify-between hover:bg-black/30 transition-colors">
                <div>
                  <label className="block text-sm font-medium text-white">Auto-Start Microphone</label>
                  <p className="text-xs text-white/40 mt-1">If enabled, Soltini will automatically start listening the moment you open the app.</p>
                </div>
                <button
                  onClick={() => handleAutoMicChange(!autoMic)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${autoMic ? 'bg-pink-500' : 'bg-white/20'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${autoMic ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Avatar Lock Toggle */}
              <div className="bg-black/20 border border-white/5 rounded-2xl p-6 flex items-center justify-between hover:bg-black/30 transition-colors">
                <div>
                  <label className="block text-sm font-medium text-white">Lock Avatar Position</label>
                  <p className="text-xs text-white/40 mt-1">Keep the avatar in its current spot. It won't wander around but will still pose and peek.</p>
                </div>
                <button
                  onClick={() => handleAvatarLockedChange(!avatarLocked)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${avatarLocked ? 'bg-pink-500' : 'bg-white/20'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${avatarLocked ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Avatar Size Slider */}
              <div className="bg-black/20 border border-white/5 rounded-2xl p-6 hover:bg-black/30 transition-colors">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-white">Avatar Size</label>
                  <span className="text-sm font-mono text-pink-400">{avatarSize}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="200"
                  value={avatarSize}
                  onChange={(e) => handleAvatarSizeChange(parseInt(e.target.value))}
                  className="w-full h-2 bg-black/40 rounded-lg appearance-none cursor-pointer accent-pink-500 mt-2"
                />
                <div className="flex justify-between text-xs text-white/40 mt-2">
                  <span>50%</span>
                  <span>100% (Default)</span>
                  <span>200%</span>
                </div>
              </div>

            </div>
          </div>
        )}

        {activeTab === 'devices' && (
          <div className="flex flex-col gap-8 max-w-2xl w-full">
            <div>
              <h3 className="text-2xl font-bold mb-2">Hardware Devices</h3>
              <p className="text-white/60 text-sm mb-6">Select your preferred audio and video inputs.</p>
            </div>

            <div className="flex flex-col gap-4">
              <div className="bg-black/20 border border-white/5 rounded-2xl p-6 flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-pink-500/20 text-pink-400">
                    <Mic className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-lg font-medium text-white">Microphone Input</h4>
                    <p className="text-sm text-white/50">Select your preferred audio input device</p>
                  </div>
                </div>
                
                <select 
                  value={micId}
                  onChange={(e) => handleMicChange(e.target.value)}
                  className="bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:border-pink-500 transition-colors w-full"
                >
                  <option value="default">System Default</option>
                  {devices.filter(d => d.kind === 'audioinput').map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || 'Unknown Microphone'}</option>
                  ))}
                </select>
              </div>

              <div className="bg-black/20 border border-white/5 rounded-2xl p-6 flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-purple-500/20 text-purple-400">
                    <Video className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-lg font-medium text-white">Camera Input</h4>
                    <p className="text-sm text-white/50">Select your preferred camera device</p>
                  </div>
                </div>
                
                <select 
                  value={camId}
                  onChange={(e) => handleCamChange(e.target.value)}
                  className="bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:border-purple-500 transition-colors w-full"
                >
                  <option value="default">System Default</option>
                  {devices.filter(d => d.kind === 'videoinput').map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || 'Unknown Camera'}</option>
                  ))}
                </select>
              </div>

              <div className="bg-black/20 border border-white/5 rounded-2xl p-6">
                 <div className="flex items-center gap-4 mb-4">
                   <div className="p-3 rounded-xl bg-blue-500/20 text-blue-400">
                     <Volume2 className="w-6 h-6" />
                   </div>
                   <div>
                     <h4 className="text-lg font-medium text-white">Audio Output</h4>
                     <p className="text-sm text-white/50">Playback device configuration</p>
                   </div>
                 </div>
                 <p className="text-sm text-white/60 bg-black/40 p-4 rounded-xl border border-white/5">
                   Output currently uses your system's default audio device. Volume can be controlled via the Windows Volume Mixer.
                 </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'api' && (
          <div className="flex flex-col gap-8 max-w-2xl w-full">
            <div>
              <h3 className="text-2xl font-bold mb-2">AI & API Keys</h3>
              <p className="text-white/60 text-sm mb-6">Configure AI models, behavior, and provider keys.</p>
            </div>

            <div className="flex flex-col gap-6">
              {/* Models */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-black/20 border border-white/5 rounded-2xl p-6">

                <div className="flex flex-col gap-2 md:col-span-2">
                  <label className="text-sm font-semibold text-white/80 flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-pink-400" /> Assistant Voice
                  </label>
                  <select 
                    value={voice}
                    onChange={(e) => handleVoiceChange(e.target.value)}
                    className="bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm focus:outline-none focus:border-pink-500 transition-colors"
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
              <div className="bg-black/20 border border-white/5 rounded-2xl p-6">
                <label className="block text-sm font-medium text-white mb-2">Personality &amp; Custom Preferences</label>
                <textarea
                  value={systemInstruction}
                  onChange={(e) => handleInstructionChange(e.target.value)}
                  rows={4}
                  className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500 font-sans resize-none"
                  placeholder="E.g., You love making sarcastic jokes..."
                />
                <p className="text-xs text-white/40 mt-2">These instructions add custom personality quirks and preferences on top of Soltini's core automation system.</p>
              </div>

              {/* Keys */}
              <div className="bg-black/20 border border-white/5 rounded-2xl p-6 flex flex-col gap-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-1">Main Gemini API Key</label>
                  <input
                    type="password"
                    value={mainApiKey}
                    onChange={(e) => handleMainApiKeyChange(e.target.value)}
                    className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500 font-sans"
                    placeholder="AIzaSy..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-1">Alternative Gemini API Key</label>
                  <input
                    type="password"
                    value={altApiKey}
                    onChange={(e) => handleAltApiKeyChange(e.target.value)}
                    className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500 font-sans"
                    placeholder="AIzaSy..."
                  />
                  <p className="text-xs text-white/40 mt-1">Fallback API key if the main key hits a rate limit.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-1">Tavily Search API Key</label>
                  <input
                    type="password"
                    value={tavilyApiKey}
                    onChange={(e) => handleTavilyApiKeyChange(e.target.value)}
                    className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500 font-sans"
                    placeholder="tvly-dev-..."
                  />
                </div>
              </div>

            </div>
          </div>
        )}

        {activeTab === 'shortcuts' && (
          <div className="flex flex-col gap-8 max-w-2xl w-full">
            <div>
              <h3 className="text-2xl font-bold mb-2">Global Shortcuts</h3>
              <p className="text-white/60 text-sm mb-6">These shortcuts work globally across your OS.</p>
            </div>
            
            <div className="bg-black/20 border border-white/5 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
                <div>
                  <h4 className="text-lg font-medium text-white">Toggle Speaker</h4>
                  <p className="text-sm text-white/50">Mute or unmute Soltini's spoken responses</p>
                </div>
                <kbd className="bg-black/40 border border-white/10 rounded-md px-3 py-1 text-sm font-mono text-pink-400">Ctrl + Alt + S</kbd>
              </div>

              <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
                <div>
                  <h4 className="text-lg font-medium text-white">Exit Pet Mode</h4>
                  <p className="text-sm text-white/50">Return to the standard window view</p>
                </div>
                <kbd className="bg-black/40 border border-white/10 rounded-md px-3 py-1 text-sm font-mono text-pink-400">Ctrl + Alt + X</kbd>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-medium text-white">Toggle Microphone</h4>
                  <p className="text-sm text-white/50">Turn the microphone on or off</p>
                </div>
                <kbd className="bg-black/40 border border-white/10 rounded-md px-3 py-1 text-sm font-mono text-pink-400">Ctrl + Alt + M</kbd>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'assets' && (
           <AssetLibrary />
        )}

        {activeTab === 'personalized' && (
          <div className="flex flex-col gap-8 max-w-2xl w-full">
            <div>
              <h3 className="text-2xl font-bold mb-2">Personalized Memory</h3>
              <p className="text-white/60 text-sm mb-6">Soltini's "invisible brain". The AI will silently extract and save important facts about you (e.g. your hobbies, preferences) from your conversations to personalize future interactions.</p>
            </div>
            
            <div className="bg-black/20 border border-white/5 rounded-2xl p-6">
              {memories.length === 0 ? (
                <p className="text-white/40 text-sm italic">No memories saved yet. Talk to Soltini naturally, and she will silently remember important details about you!</p>
              ) : (
                <div className="space-y-3">
                  {memories.map(m => (
                    <div key={m.id} className="flex items-start justify-between bg-black/40 p-4 rounded-xl border border-white/5 gap-4">
                      <div className="flex flex-col gap-1">
                        <p className="text-white/90 text-sm leading-relaxed">{m.text}</p>
                        <p className="text-white/30 text-xs">{new Date(m.createdAt).toLocaleString()}</p>
                      </div>
                      <button 
                        onClick={() => vectorMemory.deleteMemory(m.id)} 
                        className="text-pink-500 hover:text-pink-400 text-sm px-3 py-1.5 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 shrink-0 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
