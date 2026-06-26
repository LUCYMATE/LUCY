import { useState, useEffect } from 'react';
import { X, Mic, Settings as SettingsIcon, Volume2, ShieldCheck, ExternalLink, RefreshCw } from 'lucide-react';
import { checkMicrophonePermission, openMicrophonePrivacySettings } from '../lib/tauriBridge';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState('audio');
  const [micStatus, setMicStatus] = useState<'granted' | 'denied' | 'unknown' | 'checking...'>('checking...');

  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    setMicStatus('checking...');
    const status = await checkMicrophonePermission();
    setMicStatus(status);
  };

  const handleOpenSettings = async () => {
    await openMicrophonePrivacySettings();
    // After returning, they can re-check manually via refresh button
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
              Audio & Mic
            </button>
          </div>
          <div className="mt-auto">
            <button onClick={onClose} className="flex items-center gap-2 px-4 py-3 rounded-xl text-left text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-all w-full">
              <X className="w-4 h-4" /> Close Settings
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 flex flex-col overflow-y-auto bg-white/[0.02]">
          {activeTab === 'general' && (
            <div className="text-white animate-in fade-in slide-in-from-bottom-4 duration-300">
              <h3 className="text-2xl font-semibold mb-6">General Settings</h3>
              <p className="text-white/60 text-sm bg-white/5 p-4 rounded-xl border border-white/5">
                No general settings available yet. More customization options will be added here in the future.
              </p>
            </div>
          )}

          {activeTab === 'audio' && (
            <div className="text-white animate-in fade-in slide-in-from-bottom-4 duration-300">
              <h3 className="text-2xl font-semibold mb-8">Audio & Microphone</h3>
              
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6 hover:bg-white/10 transition-colors">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl ${micStatus === 'granted' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      <Mic className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-lg font-medium text-white">Native Microphone Access</h4>
                      <p className="text-sm text-white/50">Allow Myra to hear your voice seamlessly</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-sm font-bold tracking-widest uppercase ${micStatus === 'granted' ? 'text-green-400' : micStatus === 'denied' ? 'text-red-400' : 'text-yellow-400'}`}>
                      {micStatus}
                    </span>
                    <button onClick={checkPermission} className="p-2 bg-white/5 hover:bg-white/20 rounded-lg transition-colors border border-white/10" title="Refresh Status">
                      <RefreshCw className="w-4 h-4 text-white" />
                    </button>
                  </div>
                </div>

                {micStatus === 'denied' && (
                  <div className="mt-6 p-5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-4">
                    <ShieldCheck className="w-6 h-6 text-red-400 shrink-0 mt-1" />
                    <div className="text-sm">
                      <p className="text-red-200 font-semibold mb-1 text-base">Access Blocked by Windows</p>
                      <p className="text-red-200/80 mb-4 leading-relaxed">
                        Windows Privacy settings are preventing Myra from using your microphone natively. 
                        You need to allow desktop apps to access your microphone.
                      </p>
                      <button 
                        onClick={handleOpenSettings}
                        className="flex items-center gap-2 px-5 py-2.5 bg-red-500/20 hover:bg-red-500/40 text-red-100 rounded-lg transition-colors font-medium text-sm border border-red-500/30"
                      >
                        <ExternalLink className="w-4 h-4" /> Open Privacy Settings
                      </button>
                    </div>
                  </div>
                )}
                {micStatus === 'granted' && (
                  <div className="mt-4 text-sm text-green-400/80 bg-green-500/5 p-3 rounded-lg border border-green-500/10">
                    Microphone is ready and configured natively.
                  </div>
                )}
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
