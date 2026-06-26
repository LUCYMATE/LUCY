import { useState, useEffect } from 'react';
import { X, Settings as SettingsIcon, Volume2 } from 'lucide-react';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState('audio');

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
