import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Send, Activity, Mic, MicOff, Volume2, VolumeX, Trash2, Download } from 'lucide-react';
const Myra3D = lazy(() => import('./Myra3D').then(module => ({ default: module.Myra3D })));
import { GeminiLive } from '../lib/gemini-live';
import { AudioRecorder } from '../lib/audio-recorder';
import { AudioPlayer } from '../lib/audio-player';
import { logger } from '../lib/logger';
import { AudioVisualizer } from './AudioVisualizer';

type Role = 'user' | 'model';
interface Message {
  id: string;
  role: Role;
  text: string;
}

export function Chat({ isMiniMode = false }: { isMiniMode?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'model', text: 'System ready. I am Myra. How can I assist you?' },
  ]);
  const [input, setInput] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMicPending, setIsMicPending] = useState(false);
  const [connectionState, setConnectionState] = useState<'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'>('idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem('myra_muted') === 'true');
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);
  const [avatarSize, setAvatarSize] = useState(() => localStorage.getItem('myra_avatar_size') || 'Medium');

  const containerRef = useRef<HTMLDivElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const geminiRef = useRef<GeminiLive | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  // Track the id of the currently-building model transcript bubble
  const modelBubbleIdRef = useRef<string>('');
  // Timer to detect end of audio stream
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const stopSpeakingTimer = () => {
    if (speakTimerRef.current) {
      clearTimeout(speakTimerRef.current);
      speakTimerRef.current = null;
    }
  };

  const resetSpeakingTimer = useCallback((additionalDelaySecs = 0) => {
    stopSpeakingTimer();
    speakTimerRef.current = setTimeout(() => {
      setIsSpeaking(false);
      modelBubbleIdRef.current = ''; // close current bubble so next response is fresh
    }, additionalDelaySecs * 1000 + 500); // add a 500ms buffer
  }, []);

  const initSystem = () => {
    logger.add('info', 'System Boot', 'Initializing MyraOS and Gemini connection...');
    setInitialized(true);

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (!apiKey) {
      logger.add('error', 'API Key Missing', 'VITE_GEMINI_API_KEY not found in .env');
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'model',
        text: '⚠️ Error: VITE_GEMINI_API_KEY not found in .env',
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
    setOutputAnalyser(player.getAnalyser());

    // ── State changes ────────────────────────────────────────────
    gemini.onStateChange = (state, detail) => {
      setConnectionState(state);
      setStatusDetail(detail ?? '');
      if (state === 'error' && detail) {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(), role: 'model',
          text: `⚠️ ${detail}`,
        }]);
      }
    };

    // ── Thinking indicator ───────────────────────────────────────
    gemini.onThinking = (thinking) => {
      setIsThinking(thinking);
    };

    // ── Audio playback ───────────────────────────────────────────
    gemini.onAudio = (pcmBase64) => {
      setIsSpeaking(true);
      player.playChunk(pcmBase64);
      resetSpeakingTimer(player.getRemainingTime());
    };

    // ── Transcripts (text of what model says and hears) ──────────
    gemini.onTranscript = (text, isInput) => {
      setIsThinking(false);
      if (isInput) {
        // User's mic was transcribed — add as user bubble
        modelBubbleIdRef.current = ''; // Reset so the next model response starts in a fresh bubble!
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(), role: 'user', text,
        }]);
      } else {
        // Model output transcript — append to current model bubble
        let existingId = modelBubbleIdRef.current;
        if (!existingId) {
          existingId = crypto.randomUUID();
          modelBubbleIdRef.current = existingId;
          setMessages(prev => [...prev, { id: existingId, role: 'model', text }]);
        } else {
          setMessages(prev =>
            prev.map(m =>
              m.id === existingId ? { ...m, text: m.text + text } : m
            )
          );
        }
      }
    };

    gemini.connect(apiKey);
  };

  // Listen for settings changes and reconnect
  useEffect(() => {
    const handleSettingsChanged = () => {
      if (initialized) {
        logger.add('info', 'System Reconnect', 'Settings changed. Reconnecting core...');
        geminiRef.current?.disconnect();
        recorderRef.current?.stop();
        playerRef.current?.stop();
        setInputAnalyser(null);
        setOutputAnalyser(null);
        setIsListening(false);
        setIsSpeaking(false);
        setIsThinking(false);
        setAvatarSize(localStorage.getItem('myra_avatar_size') || 'Medium');
        modelBubbleIdRef.current = '';
        
        setTimeout(() => {
          initSystem();
        }, 800);
      }
    };
    window.addEventListener('myra-settings-changed', handleSettingsChanged);
    return () => {
      window.removeEventListener('myra-settings-changed', handleSettingsChanged);
    };
  }, [initialized]);

  const toggleMic = async () => {
    if (isMicPending) return; // Prevent multiple clicks

    if (!isListening) {
      setIsMicPending(true);
      try {
        logger.add('info', 'User Action', 'Toggled microphone ON');
        modelBubbleIdRef.current = ''; // Reset so the next model response starts in a fresh bubble!
        await recorderRef.current?.start();
        if (recorderRef.current) {
          setInputAnalyser(recorderRef.current.getAnalyser());
          recorderRef.current.onData = (pcm16) => {
            geminiRef.current?.sendAudio(pcm16);
          };
        }
        setIsListening(true);
      } catch (e) {
        console.error('Mic error:', e);
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(), role: 'model',
          text: '⚠️ Microphone access denied or unavailable.',
        }]);
      } finally {
        setIsMicPending(false);
      }
    } else {
      setIsMicPending(true);
      logger.add('info', 'User Action', 'Toggled microphone OFF');
      recorderRef.current?.stop();
      setInputAnalyser(null);
      setIsListening(false);
      setIsMicPending(false);
    }
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    playerRef.current?.setMuted(newMuted);
    logger.add('info', 'Audio Output', newMuted ? 'Muted spoken response.' : 'Unmuted spoken response.');
  };

  const clearChat = () => {
    if (window.confirm("Are you sure you want to clear the conversation?")) {
      setMessages([
        { id: '1', role: 'model', text: 'System ready. I am Myra. How can I assist you?' },
      ]);
      modelBubbleIdRef.current = '';
      logger.add('info', 'Chat Action', 'Cleared chat history.');
    }
  };

  const exportChat = () => {
    try {
      const markdown = messages.map(m => {
        const roleName = m.role === 'user' ? 'User' : 'Myra';
        return `### **${roleName}**\n\n${m.text}\n\n---`;
      }).join('\n\n');
      
      const fileContent = `# Myra Voice Assistant Chat History\nExported on: ${new Date().toLocaleString()}\n\n${markdown}`;
      const blob = new Blob([fileContent], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Myra_Chat_History_${Date.now()}.md`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      logger.add('success', 'Chat Action', 'Exported chat history successfully.');
    } catch (e) {
      console.error('Export failed:', e);
      logger.add('error', 'Chat Action', 'Failed to export chat history.');
    }
  };

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
    modelBubbleIdRef.current = ''; // new exchange → fresh bubble
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const statusColor =
    connectionState === 'connected' ? 'text-green-400' :
      connectionState === 'error' ? 'text-red-400' :
        connectionState === 'idle' ? 'text-white/40' : 'text-yellow-400';

  const statusLabel =
    connectionState === 'connected' ? 'LIVE CONNECTION ACTIVE' :
      connectionState === 'connecting' ? 'CONNECTING…' :
        connectionState === 'error' ? `ERROR${statusDetail ? `: ${statusDetail.slice(0, 40)}` : ''}` :
          connectionState === 'disconnected' ? 'DISCONNECTED' : 'IDLE';

  return (
    <div className="flex flex-col h-full min-h-0 bg-transparent">
      {!initialized ? (
        /* ── Splash Screen ──────────────────────────────────────── */
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-1000">
          <div className="w-32 h-32 rounded-full bg-pink-500/10 flex items-center justify-center mb-8 relative">
            <div className="absolute inset-0 bg-pink-500/20 blur-xl rounded-full animate-pulse" />
            <Activity className="w-12 h-12 text-pink-500 relative z-10" />
          </div>
          <h2 className="text-3xl font-bold tracking-widest uppercase mb-4 text-white">System Myra</h2>
          <p className="text-white/50 max-w-md mb-12">
            Autonomous intelligence core. Gemini 3.1 Flash Live.
          </p>
          <button
            onClick={initSystem}
            className="px-12 h-16 rounded-3xl bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold tracking-[0.2em] transform hover:scale-105 transition-all shadow-[0_0_40px_rgba(244,63,94,0.4)]"
          >
            INITIALIZE CORE
          </button>
        </div>
      ) : (
        <>
          {/* ── Top Status Bar ────────────────────────────────────── */}
          {!isMiniMode && (
            <div className="shrink-0 p-4 flex justify-between items-center gap-4 border-b border-white/5 bg-black/10">
              {/* Left side actions */}
              <div className="flex items-center gap-3">
              <button
                onClick={clearChat}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-white/80 hover:bg-white/5 transition-all cursor-pointer"
                title="Clear entire conversation"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
              <button
                onClick={exportChat}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/40 hover:text-white/80 hover:bg-white/5 transition-all cursor-pointer"
                title="Export conversation history to markdown"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
            </div>
            
            {/* Right side status */}
            <div className={`flex items-center gap-2 text-xs font-mono ${statusColor}`}>
              <Activity className={`w-4 h-4 ${connectionState === 'connected' ? 'animate-pulse' :
                  connectionState === 'connecting' ? 'animate-spin' : ''
                }`} />
              {statusLabel}
            </div>
          </div>
          )}

          {/* ── Chat Area ─────────────────────────────────────────── */}
          <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden" ref={containerRef}>
            {/* 3D avatar floating widget (Portaled to body to float over everything) */}
            {createPortal(
              <motion.div 
                drag 
                dragConstraints={typeof window !== 'undefined' ? { left: -window.innerWidth, right: window.innerWidth, top: -window.innerHeight, bottom: window.innerHeight } : undefined}
                dragElastic={0.1}
                dragMomentum={false}
                className={`absolute z-[9999] cursor-grab active:cursor-grabbing flex items-center justify-center ${
                  avatarSize === 'Small' ? 'w-48 h-64' :
                  avatarSize === 'Large' ? 'w-96 h-[500px]' :
                  'w-64 h-96'
                } ${isMiniMode ? 'right-0 top-0 bottom-0 left-0 m-auto' : 'bottom-10 right-10'}`}
              >
                <Suspense fallback={null}>
                  <Myra3D isSpeaking={isSpeaking} isThinking={isThinking} isListening={isListening} />
                </Suspense>
              </motion.div>,
              document.body
            )}

            {/* Messages */}
            {!isMiniMode && (
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
                      {m.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            )}

            {/* Visualizer Panel */}
            <div className={`w-full px-6 flex items-center justify-center relative overflow-hidden z-10 shrink-0 ${isMiniMode ? 'h-full flex-1' : 'h-12'}`}>
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
                {/* Mic button */}
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={isMicPending}
                  title={isListening ? 'Stop microphone' : 'Start microphone'}
                  className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center border transition-all ${isListening
                      ? 'bg-pink-600/30 border-pink-500 text-pink-400 shadow-[0_0_20px_rgba(236,72,153,0.5)] animate-pulse'
                      : 'bg-black/40 border-white/10 text-white/40 hover:border-white/30 hover:text-white/70'
                    } ${isMicPending ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isListening ? <Mic className="w-5 h-5" /> : (isMicPending ? <Activity className="w-5 h-5 animate-spin" /> : <MicOff className="w-5 h-5" />)}
                </button>

                {/* Mute button */}
                <button
                  type="button"
                  onClick={toggleMute}
                  title={isMuted ? "Unmute Myra's voice" : "Mute Myra's voice"}
                  className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center border transition-all cursor-pointer ${isMuted
                      ? 'bg-red-600/30 border-red-500 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.5)]'
                      : 'bg-black/40 border-white/10 text-white/40 hover:border-white/30 hover:text-white/70'
                    }`}
                >
                  {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>

                {/* Text input (Hidden in mini mode) */}
                {!isMiniMode && (
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
                )}
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
