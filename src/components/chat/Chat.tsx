import { useState, useRef, useEffect, useCallback } from 'react';
import { Activity, Mic, MicOff, Volume2, VolumeX, Send, X } from 'lucide-react';
import { listen, emit } from '@tauri-apps/api/event';
import { GeminiLive } from '../../lib/gemini/gemini-live';
import { AudioRecorder } from '../../lib/audio/audio-recorder';
import { AudioPlayer } from '../../lib/audio/audio-player';
import { logger } from '../../lib/store/logger';
import { AudioVisualizer } from '../avatar/AudioVisualizer';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { chatHistory } from '../../lib/store/chatHistory';
import { useShallow } from 'zustand/react/shallow';
import { useAvatarState } from '../../lib/store/avatarState';
import { BOT_NAME } from '../../config/bot-profile';

type Role = 'user' | 'model';
interface Message {
  id: string;
  role: Role;
  text: string;
}

const cleanMessageText = (text: string) => {
  let cleaned = text.replace(/^\[.*?\]\s*/, '');
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
  cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();
  return cleaned;
};

export function Chat({ isPetMode = false }: { isPetMode?: boolean }) {
  const [activeChatId, setActiveChatId] = useState<string>(() => crypto.randomUUID());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [initialized, setInitialized] = useState(false);
  const isMicPendingRef = useRef(false);
  const [isMicPending, setIsMicPendingState] = useState(false);

  const setIsMicPending = (val: boolean) => {
    isMicPendingRef.current = val;
    setIsMicPendingState(val);
  };
  
  const [statusDetail, setStatusDetail] = useState('');
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem('soltini_muted') === 'true');
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);

  const { setSpeaking, setThinking, setListening, setEmotion, setIsMicOn, isMicOn, isListening, isSpeaking, isToolAgentRunning, connectionState, setConnectionState } = useAvatarState(useShallow(s => ({
    setSpeaking: s.setSpeaking,
    setThinking: s.setThinking,
    setListening: s.setListening,
    setEmotion: s.setEmotion,
    setIsMicOn: s.setIsMicOn,
    isMicOn: s.isMicOn,
    isListening: s.isListening,
    isSpeaking: s.isSpeaking,
    isToolAgentRunning: s.isToolAgentRunning,
    connectionState: s.connectionState,
    setConnectionState: s.setConnectionState
  })));

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const geminiRef = useRef<GeminiLive | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const modelBubbleIdRef = useRef<string>('');
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [petDragOffset, setPetDragOffset] = useState({ x: 0, y: 0 });
  const isPetDraggingRef = useRef(false);
  const petDragStartRef = useRef({ x: 0, y: 0 });
  const petCurrentOffsetRef = useRef({ x: 0, y: 0 });

  const handlePetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only left click
    if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).closest('button')) {
      return; // Don't drag if clicking buttons
    }
    isPetDraggingRef.current = true;
    petDragStartRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePetPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPetDraggingRef.current) return;
    const dx = e.clientX - petDragStartRef.current.x;
    const dy = e.clientY - petDragStartRef.current.y;
    setPetDragOffset({
      x: petCurrentOffsetRef.current.x + dx,
      y: petCurrentOffsetRef.current.y + dy
    });
  };

  const handlePetPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPetDraggingRef.current) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      petCurrentOffsetRef.current = { x: petDragOffset.x, y: petDragOffset.y };
      isPetDraggingRef.current = false;
    }
  };

  const dragStartRef = useRef<{x: number, y: number} | null>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragStartRef.current && e.buttons === 1) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        getCurrentWindow().startDragging();
        dragStartRef.current = null;
      }
    }
  };

  const handlePointerUp = () => {
    dragStartRef.current = null;
  };

  // Auto-scroll and Auto-save (debounced to avoid saving on every transcript chunk)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      chatHistory.saveChat(activeChatId, messages);
    }, 500);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages, activeChatId]);

  const stopSpeakingTimer = () => {
    if (speakTimerRef.current) {
      clearTimeout(speakTimerRef.current);
      speakTimerRef.current = null;
    }
  };

  const resetSpeakingTimer = useCallback((additionalDelaySecs = 0) => {
    stopSpeakingTimer();
    speakTimerRef.current = setTimeout(() => {
      setSpeaking(false);
      modelBubbleIdRef.current = '';
    }, additionalDelaySecs * 1000 + 500); 
  }, [setSpeaking]);

  const initSystem = (autoMic = false) => {
    logger.add('info', 'System Boot', `Initializing ${BOT_NAME}OS and Gemini connection...`);
    setInitialized(true);

    const apiKey = localStorage.getItem('soltini_main_api_key') || import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    const altApiKey = localStorage.getItem('soltini_alt_api_key') || undefined;
    
    if (!apiKey) {
      logger.add('error', 'API Key Missing', 'No API key found in Settings or .env');
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'model',
        text: '⚠️ Error: No Gemini API Key found. Please add one in Settings.',
      }]);
      return;
    }

    const gemini = new GeminiLive();
    const player = new AudioPlayer();
    const recorder = new AudioRecorder();

    geminiRef.current = gemini;
    playerRef.current = player;
    recorderRef.current = recorder;

    player.start();
    const outAnalyser = player.getAnalyser();
    setOutputAnalyser(outAnalyser);

    let hasSentGreeting = false;
    gemini.onStateChange = (state, detail) => {
      setConnectionState(state);
      setStatusDetail(detail ?? '');

      if (state === 'connected' && !hasSentGreeting) {
        hasSentGreeting = true;
        gemini.sendText("System instruction: The user has just booted up the application. Greet the user with a fun, casual, or slightly flirty welcome message. Keep it to one short sentence. Do not say you are an AI or acknowledge this prompt.");
      }

      if (state === 'error' && detail) {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(), role: 'model',
          text: `⚠️ ${detail}`,
        }]);
      }
    };

    gemini.onThinking = (thinking) => {
      setThinking(thinking);
    };

    gemini.onAudio = (pcmBase64) => {
      setSpeaking(true);
      player.playChunk(pcmBase64);
      resetSpeakingTimer(player.getRemainingTime());
    };

    gemini.onTranscript = (text, isInput) => {
      setThinking(false);
      if (isInput) {
        modelBubbleIdRef.current = ''; 
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(), role: 'user', text,
        }]);
      } else {
        // Parse for emotion tags e.g., [happy]
        const emotionRegex = /\[(happy|sad|angry|surprised|thinking|neutral)\]/i;
        const match = text.match(emotionRegex);
        let cleanText = text;
        if (match) {
          const matchedEmotion = match[1].toLowerCase() as any;
          setEmotion(matchedEmotion);
          cleanText = text.replace(emotionRegex, '').trim();
        }

        if (!cleanText) return; // if it was only the tag, don't append empty text yet

        let existingId = modelBubbleIdRef.current;
        if (!existingId) {
          existingId = crypto.randomUUID();
          modelBubbleIdRef.current = existingId;
          setMessages(prev => [...prev, { id: existingId, role: 'model', text: cleanText }]);
        } else {
          setMessages(prev =>
            prev.map(m =>
              m.id === existingId ? { ...m, text: m.text + cleanText } : m
            )
          );
        }
      }
    };

    gemini.onInterrupted = () => {
      player.stopCurrentPlayback();
      setSpeaking(false);
      modelBubbleIdRef.current = '';
    };

    gemini.connect(apiKey, altApiKey);

    if (autoMic) {
      setTimeout(() => {
        toggleMicRef.current();
      }, 100);
    }
  };

  useEffect(() => {
    if (!initialized && localStorage.getItem('soltini_launch_pet_mode') === 'true') {
      initSystem();
    }
  }, []);

  useEffect(() => {
    const handleSettingsChanged = () => {
      if (initialized) {
        logger.add('info', 'System Reconnect', 'Settings changed. Reconnecting core...');
        geminiRef.current?.disconnect();
        recorderRef.current?.stop();
        playerRef.current?.stop();
        setInputAnalyser(null);
        setOutputAnalyser(null);
        setListening(false);
        setIsMicOn(false);
        setSpeaking(false);
        setThinking(false);
        modelBubbleIdRef.current = '';
        
        setTimeout(() => {
          initSystem();
        }, 800);
      }
    };
    window.addEventListener('soltini-core-settings-changed', handleSettingsChanged);
    return () => {
      window.removeEventListener('soltini-core-settings-changed', handleSettingsChanged);
    };
  }, [initialized, setListening, setSpeaking, setThinking]);

  const toggleMic = async () => {
    if (isMicPendingRef.current) return; 

    const currentMicOn = useAvatarState.getState().isMicOn;

    if (!currentMicOn) {
      setIsMicPending(true);
      try {
        logger.add('info', 'User Action', 'Toggled microphone ON');
        playerRef.current?.stopCurrentPlayback();
        setSpeaking(false);
        modelBubbleIdRef.current = ''; 
        await recorderRef.current?.start();
        if (recorderRef.current) {
          setInputAnalyser(recorderRef.current.getAnalyser());
          recorderRef.current.onData = (pcm16) => {
            geminiRef.current?.sendAudio(pcm16);
          };
          
          // Play a tiny, subtle 'ready' beep so the user knows they can speak
          try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.1);
            setTimeout(() => ctx.close(), 200);
          } catch(e) {}
        }
        setListening(true);
        setIsMicOn(true);
      } catch (e) {
        console.error('Mic error:', e);
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(), role: 'model',
          text: '⚠️ Microphone access denied or unavailable.',
        }]);
        setListening(false);
        setIsMicOn(false);
      } finally {
        setIsMicPending(false);
      }
    } else {
      setIsMicPending(true);
      try {
        logger.add('info', 'User Action', 'Toggled microphone OFF');
        try {
          recorderRef.current?.stop();
        } catch (e) {
          console.error("Error stopping recorder:", e);
        }
        try {
          // Tell Gemini the turn is complete so it processes the audio
          geminiRef.current?.endTurn();
        } catch (e) {
          console.error("Error sending turnComplete:", e);
        }
        setInputAnalyser(null);
        setListening(false);
        setIsMicOn(false);
      } finally {
        setIsMicPending(false);
      }
    }
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    playerRef.current?.setMuted(newMuted);
    logger.add('info', 'Audio Output', newMuted ? 'Muted spoken response.' : 'Unmuted spoken response.');
  };

  const toggleMicRef = useRef(toggleMic);
  toggleMicRef.current = toggleMic;

  const toggleMuteRef = useRef(toggleMute);
  toggleMuteRef.current = toggleMute;

  useEffect(() => {
    const fns: (() => void)[] = [];
    let mounted = true;

    listen('soltini-toggle-mic', () => {
      if (mounted) toggleMicRef.current();
    }).then(fn => { if (mounted) fns.push(fn); else fn(); });

    listen('soltini-toggle-mute', () => {
      if (mounted) toggleMuteRef.current();
    }).then(fn => { if (mounted) fns.push(fn); else fn(); });

    return () => {
      mounted = false;
      fns.forEach(fn => fn());
    };
  }, []);

  const clearChat = () => {
    if (window.confirm("Are you sure you want to clear the conversation?")) {
      setMessages([
        { id: crypto.randomUUID(), role: 'model', text: `System ready. I am ${BOT_NAME}. How can I assist you?` },
      ]);
      modelBubbleIdRef.current = '';
      logger.add('info', 'Chat Action', 'Cleared chat history.');
    }
  };

  const exportChat = () => {
    try {
      const markdown = messages.map(m => {
        const roleName = m.role === 'user' ? 'User' : BOT_NAME;
        return `### **${roleName}**\n\n${m.text}\n\n---`;
      }).join('\n\n');
      
      const fileContent = `# ${BOT_NAME} Voice Assistant Chat History\nExported on: ${new Date().toLocaleString()}\n\n${markdown}`;
      const blob = new Blob([fileContent], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${BOT_NAME}_Chat_History_${Date.now()}.md`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      logger.add('success', 'Chat Action', 'Exported chat history successfully.');
    } catch (e) {
      console.error('Export failed:', e);
      logger.add('error', 'Chat Action', 'Failed to export chat history.');
    }
  };

  useEffect(() => {
    const handleClear = () => clearChat();
    const handleExport = () => exportChat();
    const handleNewChat = () => {
      setMessages([{ id: crypto.randomUUID(), role: 'model', text: `System ready. I am ${BOT_NAME}. How can I assist you?` }]);
      setActiveChatId(crypto.randomUUID());
      modelBubbleIdRef.current = '';
    };
    const handleLoadChat = (e: any) => {
      const detail = e.detail;
      if (detail && detail.id) {
        setMessages(detail.messages || []);
        setActiveChatId(detail.id);
        modelBubbleIdRef.current = '';
      }
    };

    const handleForceInit = () => {
      if (!initialized) initSystem();
    };

    window.addEventListener('soltini-clear-chat', handleClear);
    window.addEventListener('soltini-export-chat', handleExport);
    window.addEventListener('soltini-new-chat', handleNewChat);
    window.addEventListener('soltini-load-chat', handleLoadChat);
    window.addEventListener('soltini-force-init', handleForceInit);
    return () => {
      window.removeEventListener('soltini-clear-chat', handleClear);
      window.removeEventListener('soltini-export-chat', handleExport);
      window.removeEventListener('soltini-new-chat', handleNewChat);
      window.removeEventListener('soltini-load-chat', handleLoadChat);
      window.removeEventListener('soltini-force-init', handleForceInit);
    };
  }, [messages, activeChatId, initialized]);

  const handleSendText = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!geminiRef.current?.isReady()) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'model',
        text: '⚠️ Not connected yet. Wait for LIVE CONNECTION ACTIVE.',
      }]);
      return;
    }
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(), role: 'user', text: trimmed,
    }]);
    modelBubbleIdRef.current = ''; 
    playerRef.current?.stopCurrentPlayback();
    setSpeaking(false);
    geminiRef.current.sendText(trimmed);
    setInput('');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSpeakingTimer();
      geminiRef.current?.disconnect();
      recorderRef.current?.stop();
      playerRef.current?.stop();
    };
  }, []); 

  // Auto-initialize the system (and open the mic) on mount
  useEffect(() => {
    if (!initialized) {
      const timer = setTimeout(() => {
        initSystem(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [initialized]);

  const statusColor =
    connectionState === 'connected' ? 'text-green-400' :
      connectionState === 'error' ? 'text-red-400' :
        connectionState === 'idle' ? 'text-white/40' : 'text-yellow-400';

  const statusLabel =
    connectionState === 'connected' ? (isMicOn ? 'CONNECTED (MIC ON)' : 'CONNECTED (MIC OFF)') :
      connectionState === 'connecting' ? 'CONNECTING…' :
        connectionState === 'error' ? `ERROR${statusDetail ? `: ${statusDetail.slice(0, 40)}` : ''}` :
          connectionState === 'disconnected' ? 'DISCONNECTED' : 'IDLE';

  return (
    <div className={`flex flex-col h-full min-h-0 bg-transparent ${isPetMode ? 'pointer-events-none' : ''}`}>
      <>
          {/* ── Pet Status Bar ────────────────────────────────────── */}
          {isPetMode && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[200] pointer-events-auto flex items-center gap-2">
              
              {/* Agent Status (Purple Dot) */}
              {isToolAgentRunning && (
                <div className="flex items-center" title="Agent is working...">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute w-1.5 h-1.5 rounded-full bg-purple-500 animate-ping opacity-60"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div>
                  </div>
                </div>
              )}

              {/* Connection Status (Green/Yellow/Red Dot) */}
              <div 
                className={`flex items-center ${['disconnected', 'error'].includes(connectionState) ? 'cursor-pointer hover:scale-110' : ''}`}
                title={['disconnected', 'error'].includes(connectionState) ? "Disconnected - Click to reconnect" : "Connection Status"}
                onClick={() => {
                  if (['disconnected', 'error'].includes(connectionState)) initSystem();
                }}
              >
                <div className="relative flex items-center justify-center">
                  {connectionState === 'connected' && (
                    <>
                      <div className="absolute w-1.5 h-1.5 rounded-full bg-green-500 animate-ping opacity-60"></div>
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
                    </>
                  )}
                  {connectionState === 'connecting' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"></div>
                  )}
                  {/* The Red Bouncing Disconnect Dot */}
                  {['disconnected', 'error'].includes(connectionState) && (
                    <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,1)] animate-bounce"></div>
                  )}
                </div>
              </div>

              {/* Mic Status (Pink/Grey Dot) */}
              <div 
                className="flex items-center cursor-pointer hover:scale-110 transition-transform"
                title={isMicOn ? "Microphone ON - Click to Mute" : "Microphone OFF - Click to Listen"}
                onClick={toggleMic}
              >
                <div className="relative flex items-center justify-center">
                  {isMicOn ? (
                    <>
                      <div className="absolute w-1.5 h-1.5 rounded-full bg-pink-500 animate-ping opacity-60"></div>
                      <div className="w-1.5 h-1.5 rounded-full bg-pink-400"></div>
                    </>
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-white/20"></div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* ── Top Status Bar ────────────────────────────────────── */}
          {!isPetMode && (
            <div className="shrink-0 p-4 flex items-center gap-4 justify-between border-b border-white/5 bg-black/10">
            {isToolAgentRunning ? (
              <div className="flex items-center gap-2 text-pink-400 font-mono text-xs animate-pulse">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500"></span>
                </span>
                SYSTEM AGENT RUNNING…
              </div>
            ) : (
              <div /> // empty placeholder for layout balance
            )}
            <div 
              className={`flex items-center gap-2 font-mono transition-all text-xs ${statusColor} ${['disconnected', 'error'].includes(connectionState) ? 'cursor-pointer hover:scale-105' : ''}`}
              onClick={() => {
                if (['disconnected', 'error'].includes(connectionState)) initSystem();
              }}
              title={['disconnected', 'error'].includes(connectionState) ? "Click to reconnect" : ""}
            >
              <Activity className={`w-4 h-4 ${connectionState === 'connected' ? 'animate-pulse' :
                  connectionState === 'connecting' ? 'animate-spin' : ''
                }`} />
              {statusLabel}
            </div>
          </div>
          )}

          {/* ── Content Area ─────────────────────────────────────────── */}
          {!isPetMode && (
            <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden" ref={containerRef}>
              
              {/* Messages */}
              <div
                className="flex-1 overflow-y-auto p-6 space-y-4 z-10 relative pointer-events-auto"
                ref={scrollRef}
              >
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-5 py-3 ${m.role === 'user'
                        ? 'bg-white/10 text-white rounded-br-none backdrop-blur-md'
                        : 'bg-pink-500/10 border border-pink-500/20 text-pink-50 rounded-bl-none backdrop-blur-md'
                      }`}>
                      <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap">
                        {m.role === 'model' ? cleanMessageText(m.text) : m.text}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Visualizer Panel */}
              <div className="w-full px-6 flex items-center justify-center relative overflow-hidden z-10 shrink-0 h-12">
                <div className="w-full h-full max-w-xl">
                  {isListening ? (
                    <AudioVisualizer analyser={inputAnalyser} isActive={isListening} type="input" />
                  ) : (
                    <AudioVisualizer analyser={outputAnalyser} isActive={isSpeaking} type="output" />
                  )}
                </div>
              </div>

              {/* ── Input Dock ────────────────────────────────────────── */}
              <div className="p-6 shrink-0 z-10 relative">
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSendText(); }}
                  className="flex items-center gap-4 w-full"
                >
                  <button
                    type="button"
                    onClick={toggleMic}
                    disabled={isMicPending}
                    title={isMicOn ? 'Stop microphone' : 'Start microphone'}
                    className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center border transition-all ${isMicOn
                        ? 'bg-pink-600/30 border-pink-500 text-pink-400 shadow-[0_0_20px_rgba(236,72,153,0.5)] animate-pulse'
                        : 'bg-black/40 border-white/10 text-white/40 hover:border-white/30 hover:text-white/70'
                      } ${isMicPending ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isMicOn ? <Mic className="w-5 h-5" /> : (isMicPending ? <Activity className="w-5 h-5 animate-spin" /> : <MicOff className="w-5 h-5" />)}
                  </button>

                  <button
                    type="button"
                    onClick={toggleMute}
                    title={isMuted ? "Unmute Soltini's voice" : "Mute Soltini's voice"}
                    className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center border transition-all cursor-pointer ${isMuted
                        ? 'bg-red-600/30 border-red-500 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.5)]'
                        : 'bg-black/40 border-white/10 text-white/40 hover:border-white/30 hover:text-white/70'
                      }`}
                  >
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </button>

                  <div className="flex-1 bg-black/40 backdrop-blur-lg border border-white/10 rounded-2xl h-14 flex items-center px-4 gap-4">
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={connectionState === 'connected' ? 'Type a message…' : 'Connecting to Gemini…'}
                      className="bg-transparent border-none outline-none w-full text-white placeholder-white/20 font-light"
                    />
                    <button
                      type="submit"
                      disabled={!input.trim() || connectionState !== 'connected'}
                      className="h-10 px-6 shrink-0 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold text-sm tracking-wide hover:opacity-90 transition-opacity disabled:opacity-30 flex items-center justify-center"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
    </div>
  );
}
