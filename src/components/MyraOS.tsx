import { Settings } from 'lucide-react';
import { Chat } from './Chat';
import { useState } from 'react';
import { SettingsModal } from './SettingsModal';

export function MyraOS() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="flex h-full w-full gap-4 sm:gap-6 relative max-w-[1600px] mx-auto p-4 sm:p-6 min-h-0">
      {/* Main Workspace */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 h-full">
        <section className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="glass rounded-[40px] flex-1 relative overflow-hidden flex flex-col min-h-0">
            <Chat />
          </div>
        </section>
      </main>

      {/* Navigation (originally on left, now shifted to right) */}
      <aside className="w-16 sm:w-64 shrink-0 flex flex-col gap-4">
        <div className="flex flex-col items-center sm:items-start glass rounded-3xl p-4 sm:p-6 h-full gap-8">
           <div className="flex items-center gap-3 w-full justify-center sm:justify-start">
             <div className="w-3 h-3 rounded-full bg-pink-500 ai-glow shrink-0"></div>
             <h1 className="text-xl font-bold tracking-tight text-white hidden sm:block">MYRA</h1>
           </div>
           
           <div className="flex flex-col gap-6 w-full mt-auto">
              <div className="hidden sm:block">
                <p className="text-[10px] uppercase tracking-widest text-pink-300 opacity-60 mb-1">System Latency</p>
                <p className="text-sm font-mono text-white">12ms</p>
              </div>
              <div className="w-12 h-12 sm:w-full sm:h-12 rounded-2xl glass flex items-center justify-center cursor-pointer hover:bg-white/10 transition-colors gap-2" onClick={() => setShowSettings(true)} title="Settings">
                <Settings className="w-5 h-5 text-white" />
                <span className="hidden sm:block text-white font-medium text-sm">Settings</span>
              </div>
           </div>
        </div>
      </aside>
      
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
