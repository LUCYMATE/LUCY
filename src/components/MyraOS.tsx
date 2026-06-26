import { Settings } from 'lucide-react';
import { Chat } from './Chat';
import { useState, useEffect } from 'react';
import { SettingsModal } from './SettingsModal';
import { getSystemStats, isTauriApp } from '../lib/tauriBridge';

export function MyraOS({ isMiniMode = false }: { isMiniMode?: boolean }) {
  const [showSettings, setShowSettings] = useState(false);
  const [latency, setLatency] = useState<string>('checking...');
  const [cpu, setCpu] = useState<number>(0);
  const [memory, setMemory] = useState<string>('0 / 0 GB');
  const isTauri = isTauriApp();

  useEffect(() => {
    // 1. Latency Ping checks
    const checkPing = async () => {
      try {
        const start = performance.now();
        // Fetch current origin with a cache-busting query parameter
        await fetch('/index.html?t=' + start, { method: 'HEAD' });
        const rtt = Math.round(performance.now() - start);
        setLatency(`${rtt}ms`);
      } catch (e) {
        setLatency('Offline');
      }
    };

    // 2. Tauri Stats checks
    const checkStats = async () => {
      if (!isTauri) return;
      try {
        const stats = await getSystemStats();
        if (stats) {
          setCpu(Math.round(stats.cpu_usage));
          const totalGB = (stats.total_memory / (1024 * 1024 * 1024)).toFixed(1);
          const usedGB = (stats.used_memory / (1024 * 1024 * 1024)).toFixed(1);
          setMemory(`${usedGB} / ${totalGB} GB`);
        }
      } catch (e) {
        console.warn('Failed to fetch system stats:', e);
      }
    };

    // Run immediately, then on interval
    checkPing();
    checkStats();

    const interval = setInterval(() => {
      checkPing();
      checkStats();
    }, 3000);

    return () => clearInterval(interval);
  }, [isTauri]);

  return (
    <div className="flex h-full w-full gap-4 sm:gap-6 relative max-w-[1600px] mx-auto p-4 sm:p-6 min-h-0">
      {/* Main Workspace */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 h-full">
        <section className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className={`glass rounded-[40px] flex-1 relative overflow-hidden flex flex-col min-h-0 ${isMiniMode ? '!rounded-xl' : ''}`}>
            <Chat isMiniMode={isMiniMode} />
          </div>
        </section>
      </main>

      {/* Navigation (originally on left, now shifted to right) */}
      {!isMiniMode && (
        <aside className="w-16 sm:w-64 shrink-0 flex flex-col gap-4">
          <div className="flex flex-col items-center sm:items-start glass rounded-3xl p-4 sm:p-6 h-full gap-8">
           <div className="flex items-center gap-3 w-full justify-center sm:justify-start">
             <div className="w-3 h-3 rounded-full bg-pink-500 ai-glow shrink-0"></div>
             <h1 className="text-xl font-bold tracking-tight text-white hidden sm:block">MYRA</h1>
           </div>
           
           <div className="flex flex-col gap-6 w-full mt-auto">
              <div className="hidden sm:flex flex-col gap-4 bg-white/5 border border-white/10 rounded-2xl p-4 text-left">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-pink-300 opacity-60 mb-0.5">Network Latency</p>
                  <p className="text-sm font-mono text-white">{latency}</p>
                </div>
                {isTauri && (
                  <>
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <p className="text-[10px] uppercase tracking-widest text-pink-300 opacity-60">CPU Usage</p>
                        <span className="text-xs font-mono text-white">{cpu}%</span>
                      </div>
                      <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-pink-500 h-full rounded-full transition-all duration-500" style={{ width: `${cpu}%` }} />
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-pink-300 opacity-60 mb-0.5">Memory Usage</p>
                      <p className="text-sm font-mono text-white">{memory}</p>
                    </div>
                  </>
                )}
              </div>
              
              <div className="w-12 h-12 sm:w-full sm:h-12 rounded-2xl glass flex items-center justify-center cursor-pointer hover:bg-white/10 transition-colors gap-2" onClick={() => setShowSettings(true)} title="Settings">
                <Settings className="w-5 h-5 text-white" />
                <span className="hidden sm:block text-white font-medium text-sm">Settings</span>
              </div>
             </div>
          </div>
        </aside>
      )}
      
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
