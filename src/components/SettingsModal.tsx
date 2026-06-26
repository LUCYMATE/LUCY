import { useState, useEffect } from 'react';
import { X, Settings as SettingsIcon, Volume2, Mic } from 'lucide-react';
import { logger } from '../lib/logger';

interface SettingsModalProps {
  onClose: () => void;
  onSettingsChanged?: () => void;
}

export function SettingsModal({ onClose, onSettingsChanged }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState('general');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>('');

  const [selectedModel, setSelectedModel] = useState<string>(() => localStorage.getItem('myra_model') || 'gemini-3.1-flash-live-preview');
  const [selectedVoice, setSelectedVoice] = useState<string>(() => localStorage.getItem('myra_voice') || 'Aoede');
  const [avatarSize, setAvatarSize] = useState<string>(() => localStorage.getItem('myra_avatar_size') || 'Medium');
  const [systemInstruction, setSystemInstruction] = useState<string>(() => localStorage.getItem('myra_system_instruction') || 'You are a helpful voice assistant. Keep replies conversational, concise, and natural for back-and-forth spoken chat.');
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    async function loadDevices() {
      try {
        // Request permissions first to get labels
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = allDevices.filter(d => d.kind === 'audioinput');
        setDevices(audioInputs);
        
        const savedId = localStorage.getItem('myra_mic_id');
        if (savedId && audioInputs.some(d => d.deviceId === savedId)) {
          setSelectedMic(savedId);
        } else if (audioInputs.length > 0) {
          setSelectedMic(audioInputs[0].deviceId);
          localStorage.setItem('myra_mic_id', audioInputs[0].deviceId);
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
    localStorage.setItem('myra_mic_id', val);
    setChanged(true);
    logger.add('success', 'Settings', 'Microphone changed to ' + val);
  };

  const handleModelChange = (val: string) => {
    setSelectedModel(val);
    localStorage.setItem('myra_model', val);
    setChanged(true);
    logger.add('success', 'Settings', 'Model changed to ' + val);
  };

  const handleVoiceChange = (val: string) => {
    setSelectedVoice(val);
    localStorage.setItem('myra_voice', val);
    setChanged(true);
    logger.add('success', 'Settings', 'Voice changed to ' + val);
  };

  const handleInstructionChange = (val: string) => {
    setSystemInstruction(val);
    localStorage.setItem('myra_system_instruction', val);
    setChanged(true);
  };

  const handleAvatarSizeChange = (val: string) => {
    setAvatarSize(val);
    localStorage.setItem('myra_avatar_size', val);
    setChanged(true);
    logger.add('success', 'Settings', 'Avatar size changed to ' + val);
  };


  const handleClose = () => {
    if (changed) {
      if (onSettingsChanged) {
        onSettingsChanged();
      }
      window.dispatchEvent(new CustomEvent('myra-settings-changed'));
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
              Audio
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
              <h3 className="text-2xl font-semibold mb-2">Model & Persona</h3>
              
              {/* Model Dropdown */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <label className="block text-sm font-medium text-white mb-2">Gemini Model</label>
                <select
                  value={selectedModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500"
                >
                  <option value="gemini-3.1-flash-live-preview">Gemini 3.1 Flash Live Preview (Recommended)</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash Experimental</option>
                </select>
                <p className="text-xs text-white/40 mt-2">Choose the active backend model for spoken/text core generation.</p>
              </div>

              {/* Voice Dropdown */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <label className="block text-sm font-medium text-white mb-2">AI Voice</label>
                <select
                  value={selectedVoice}
                  onChange={(e) => handleVoiceChange(e.target.value)}
                  className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500 font-sans"
                >
                  <option value="Aoede">Aoede (Female - Default)</option>
                  <option value="Kore">Kore (Female - Bright)</option>
                  <option value="Charon">Charon (Male - Deep)</option>
                  <option value="Fenrir">Fenrir (Male - Warm)</option>
                  <option value="Puck">Puck (Male - Casual)</option>
                </select>
                <p className="text-xs text-white/40 mt-2">Select the vocal synthesis avatar voice style.</p>
              </div>

              {/* Avatar Size Dropdown */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <label className="block text-sm font-medium text-white mb-2">Avatar Size</label>
                <select
                  value={avatarSize}
                  onChange={(e) => handleAvatarSizeChange(e.target.value)}
                  className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500 font-sans"
                >
                  <option value="Small">Small</option>
                  <option value="Medium">Medium (Default)</option>
                  <option value="Large">Large</option>
                </select>
                <p className="text-xs text-white/40 mt-2">Adjust the size of the 3D avatar on screen.</p>
              </div>

              {/* System Instructions Textarea */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/10 transition-colors">
                <label className="block text-sm font-medium text-white mb-2">System Instructions</label>
                <textarea
                  value={systemInstruction}
                  onChange={(e) => handleInstructionChange(e.target.value)}
                  rows={4}
                  className="w-full bg-black/40 text-white text-sm border border-white/10 rounded-lg p-3 outline-none focus:border-pink-500 font-sans resize-none"
                  placeholder="E.g., You are Myra, a helpful AI voice assistant..."
                />
                <p className="text-xs text-white/40 mt-2">System instructions define Myra's base personality, guidelines, and tone.</p>
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
        </div>
      </div>
    </div>
  );
}
