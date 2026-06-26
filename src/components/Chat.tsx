import { useState, useRef, useEffect } from 'react';
import { Send, Volume2, Mic, MicOff, MonitorUp, Activity, Settings } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Myra3D } from './Myra3D';
import { checkMicrophonePermission, openMicrophonePrivacySettings, startNativeMic, stopNativeMic, isTauriApp } from '../lib/tauriBridge';
import { startBrowserMicCapture, MicCaptureHandle } from '../lib/audio';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

type Role = 'user' | 'model';
interface Message {
  id: string;
  role: Role;
  text?: string;
  image?: string;
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'model', text: 'Live session initialized. I am Myra. How can I assist you?' }
  ]);
  const [input, setInput] = useState('');
  
  // Live API Connection state
  const [initialized, setInitialized] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const speakingTimeoutRef = useRef<number | null>(null);
  const unlistenMicRef = useRef<UnlistenFn | null>(null);
  const browserMicRef = useRef<MicCaptureHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Guards against opening two WS connections simultaneously
  const connectingRef = useRef<boolean>(false);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const initSystem = async () => {
    setInitialized(true);
    await connectToLive();
    // connectToLive now resolves only when WS is OPEN, so it's safe to start mic
    await startMic();
  };

  /**
   * Opens the WebSocket to the backend and returns a Promise that resolves
   * only once the connection is truly OPEN (avoiding the old race condition).
   */
  const connectToLive = (): Promise<void> => {
    // Already open — nothing to do
    if (wsRef.current?.readyState === WebSocket.OPEN) return Promise.resolve();
    // Already in the middle of connecting — wait for it instead of opening a 2nd socket
    if (connectingRef.current) {
      return new Promise((resolve) => {
        const poll = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            clearInterval(poll);
            resolve();
          }
        }, 50);
      });
    }

    connectingRef.current = true;
    setConnecting(true);

    return new Promise((resolve, reject) => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/api/live`);
        wsRef.current = ws;

        const outputCtx = new AudioContext({ sampleRate: 24000 });
        audioCtxRef.current = outputCtx;
        nextStartTimeRef.current = outputCtx.currentTime;

        ws.onopen = () => {
          connectingRef.current = false;
          setConnected(true);
          setConnecting(false);
          resolve(); // ← resolves the promise when truly open
        };

        ws.onerror = (err) => {
          connectingRef.current = false;
          setConnecting(false);
          reject(err);
        };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        // ── Audio from Gemini (PCM 24kHz, base64) ──────────────────────
        if (msg.audio) {
          setIsThinking(false);
          const binary = atob(msg.audio);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          try {
            const numSamples = bytes.byteLength / 2;
            const buffer = outputCtx.createBuffer(1, numSamples, 24000);
            const channelData = buffer.getChannelData(0);
            const dataView = new DataView(bytes.buffer);
            for (let i = 0; i < numSamples; i++) {
              channelData[i] = dataView.getInt16(i * 2, true) / 32768.0;
            }
            const source = outputCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(outputCtx.destination);
            if (nextStartTimeRef.current < outputCtx.currentTime) {
              nextStartTimeRef.current = outputCtx.currentTime;
            }
            source.start(nextStartTimeRef.current);
            setIsSpeaking(true);
            const playTime = nextStartTimeRef.current - outputCtx.currentTime + buffer.duration;
            if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
            speakingTimeoutRef.current = window.setTimeout(() => setIsSpeaking(false), playTime * 1000);
            nextStartTimeRef.current += buffer.duration;
          } catch (e) { console.error('Audio playback error', e); }
        }

        // ── Text part from model turn ───────────────────────────────────
        if (msg.text) {
          setIsThinking(false);
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'model' && !last.image) {
              return [...prev.slice(0, -1), { ...last, text: (last.text || '') + msg.text }];
            }
            return [...prev, { id: Date.now().toString() + Math.random(), role: 'model', text: msg.text }];
          });
        }

        // ── Transcription events (new in gemini-3.1-flash-live-preview) ─
        if (msg.transcript) {
          setIsThinking(false);
          const { role, text } = msg.transcript as { role: 'user' | 'model'; text: string };
          setMessages(prev => {
            const last = prev[prev.length - 1];
            // Append transcription to the last matching role bubble if it exists
            if (last && last.role === role && !last.image) {
              return [...prev.slice(0, -1), { ...last, text: (last.text || '') + text }];
            }
            return [...prev, { id: Date.now().toString() + Math.random(), role, text }];
          });
        }

        // ── Image generated by a tool call ─────────────────────────────
        if (msg.image) {
          setIsThinking(false);
          setMessages(prev => [
            ...prev,
            { id: Date.now().toString(), role: 'model', image: `data:image/jpeg;base64,${msg.image}` }
          ]);
        }

        // ── Screen share control actions ────────────────────────────────
        if (msg.action) {
          if (msg.action === 'startScreenShare') toggleScreenPreview(true);
          else if (msg.action === 'stopScreenShare') toggleScreenPreview(false);
        }

        // ── Model was interrupted ──────────────────────────────────────
        if (msg.interrupted) {
          nextStartTimeRef.current = outputCtx.currentTime;
        }

        // ── Server-side error forwarded to chat ────────────────────────
        if (msg.error) {
          console.error('[Myra server error]', msg.error);
          setMessages(prev => [
            ...prev,
            { id: Date.now().toString(), role: 'model', text: `⚠️ Error: ${msg.error}` }
          ]);
        }
      };

        ws.onclose = () => {
          connectingRef.current = false;
          setConnected(false);
          setMicActive(false);
          setScreenSharing(false);
          stopAudioCapture();
          stopScreenShare();
        };
      } catch (err) {
        connectingRef.current = false;
        setConnecting(false);
        reject(err);
      }
    });
  };

  const disconnect = () => {
    wsRef.current?.close();
  };

  /** Safely encodes a Uint8Array to base64 without spread (avoids stack overflow on large buffers) */
  const toBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };

  /** Starts microphone capture and streams PCM audio to the server */
  const startMic = async () => {
    if (micActive) return;
    // Ensure WS is open before starting — but don't open a second socket
    if (wsRef.current?.readyState !== WebSocket.OPEN) await connectToLive();

    const sendAudio = (base64: string) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify({ audio: base64 }));
    };

    // ── Native OS-level permission check (Tauri only) ──────────────────
    if (isTauriApp()) {
      const nativePerm = await checkMicrophonePermission();
      if (nativePerm === 'denied') {
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'model' as const,
            text: '🎙️ **Microphone access is blocked at the system level.**\n\nWindows Privacy Settings are preventing Myra from using your microphone. Click the button below to open Microphone Privacy Settings and enable access for this app, then restart Myra.',
          },
        ]);
        await openMicrophonePrivacySettings();
        return;
      }

      // ── Try native cpal mic first (Tauri) ────────────────────────────
      try {
        await startNativeMic();
        const unlisten = await listen<string>('audio-data', (event) => {
          sendAudio(event.payload);
        });
        unlistenMicRef.current = unlisten;
        setMicActive(true);
        return;
      } catch (e) {
        console.warn('Native mic unavailable, falling back to browser mic:', e);
      }
    }

    // ── Browser getUserMedia fallback (browser dev + Tauri fallback) ───
    try {
      const handle = await startBrowserMicCapture(sendAudio);
      browserMicRef.current = handle;
      setMicActive(true);
    } catch (e: any) {
      console.error('Mic error', e);
      setMicActive(false);
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'model' as const,
            text: '🎙️ **Microphone permission was denied.**\n\nPlease open **Windows Privacy Settings → Microphone** and allow access for this app, then restart.',
          },
        ]);
        await openMicrophonePrivacySettings();
      } else {
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'model' as const,
            text: `🎙️ **Could not start microphone:** ${e?.message ?? 'Unknown error'}. Check that a mic is connected and allowed in Windows settings.`,
          },
        ]);
      }
    }
  };

  const toggleMic = async (forceState?: boolean) => {
    if (forceState === false || (forceState === undefined && micActive)) {
      stopAudioCapture();
      setMicActive(false);
    } else {
      await connectToLive();
      await startMic();
    }
  };

  const toggleScreenPreview = async (forceState?: boolean) => {
    // Use wsRef instead of stale connected state
    if (wsRef.current?.readyState !== WebSocket.OPEN) await connectToLive();

    if (forceState === false || (forceState === undefined && screenSharing)) {
      stopScreenShare();
      setScreenSharing(false);
    } else {
      if (screenSharing) return;
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 } });
        screenStreamRef.current = stream;

        const videoElement = document.createElement('video');
        videoElement.srcObject = stream;
        await videoElement.play();

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const captureFrame = setInterval(() => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !screenStreamRef.current?.active) {
            clearInterval(captureFrame);
            return;
          }
          if (videoElement.videoWidth === 0) return;
          canvas.width = 640;
          canvas.height = (640 / videoElement.videoWidth) * videoElement.videoHeight;
          if (ctx) {
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
            const base64Jpeg = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
            wsRef.current.send(JSON.stringify({ video: base64Jpeg }));
          }
        }, 2000);

        stream.getVideoTracks()[0].onended = () => {
          clearInterval(captureFrame);
          setScreenSharing(false);
        };
        setScreenSharing(true);
      } catch (e) { console.error('Screen share error', e); }
    }
  };

  const stopAudioCapture = () => {
    if (unlistenMicRef.current) {
      unlistenMicRef.current();
      unlistenMicRef.current = null;
    }
    if (browserMicRef.current) {
      browserMicRef.current.stop();
      browserMicRef.current = null;
    }
    stopNativeMic();
  };

  const stopScreenShare = () => {
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
  };

  useEffect(() => {
    return () => {
      disconnect();
      stopAudioCapture();
      stopScreenShare();
    };
  }, []);

  const handleSendText = () => {
    if (!input.trim()) return;
    if (!connected) {
       connectToLive().then(() => sendText(input.trim()));
    } else {
       sendText(input.trim());
    }
  };

  const sendText = (text: string) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text }]);
    wsRef.current?.send(JSON.stringify({ text }));
    setIsThinking(true);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      {!initialized ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-1000">
          <div className="w-32 h-32 rounded-full bg-pink-500/10 flex items-center justify-center mb-8 relative">
             <div className="absolute inset-0 bg-pink-500/20 blur-xl rounded-full ai-glow animate-pulse"></div>
             <Activity className="w-12 h-12 text-pink-500 relative z-10" />
          </div>
          <h2 className="text-3xl font-bold tracking-widest uppercase mb-4 text-white">System Myra</h2>
          <p className="text-white/50 max-w-md mb-12">
             Autonomous intelligence core. By initializing, you authorize Myra to maintain an active audio link and request screen access when necessary.
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
          {/* Top Status */}
      <div className="shrink-0 p-4 flex justify-end items-center gap-4 border-b border-white/5">
         {connected ? (
            <div className="flex items-center gap-2 text-xs font-mono text-pink-400">
               <Activity className="w-4 h-4 animate-pulse" />
               LIVE LINK ACTIVE
               <button onClick={disconnect} className="ml-4 text-white/50 hover:text-white underline">Disconnect</button>
            </div>
         ) : (
            <div className="flex items-center gap-2 text-xs font-mono text-white/30">
               <MicOff className="w-4 h-4" />
               OFFLINE
            </div>
         )}
      </div>

      {/* Chat Container */}
      <div className="relative flex-1 flex flex-col overflow-hidden">
        {/* 3D View Background Overlay */}
        <div className="absolute inset-0 z-0 pointer-events-none flex items-center justify-center">
           <Myra3D isSpeaking={isSpeaking} isThinking={isThinking} />
        </div>

        {/* Messaging Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 z-10 relative pointer-events-auto" ref={scrollRef}>
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[70%] rounded-2xl px-5 py-3 ${m.role === 'user' ? 'bg-white/10 text-white rounded-br-none backdrop-blur-md' : 'bg-pink-500/10 border border-pink-500/20 text-pink-50 rounded-bl-none backdrop-blur-md'}`}>
               {m.text && (
                 <div className="prose prose-invert prose-sm max-w-none">
                   <ReactMarkdown>{m.text}</ReactMarkdown>
                 </div>
               )}
               {m.image && (
                 <img src={m.image} alt="Generated" className="mt-2 rounded-xl border border-white/20 w-full" />
               )}
            </div>
          </div>
        ))}
          {connecting && (
             <div className="w-6 h-6 rounded-full border-t-2 border-r-2 border-pink-500 animate-spin ai-glow ml-4"></div>
          )}
        </div>

        {/* Input Dock */}
        <div className="p-6 shrink-0 z-10 relative">
          <form onSubmit={(e) => { e.preventDefault(); handleSendText(); }} className="flex items-center gap-4 w-full">
            {/* Mic Toggle */}
            <button
              type="button"
              onClick={() => toggleMic()}
              title={micActive ? 'Mute mic' : 'Unmute mic'}
              className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center border transition-all ${
                micActive
                  ? 'bg-pink-600/30 border-pink-500 text-pink-400 shadow-[0_0_16px_rgba(244,63,94,0.4)]'
                  : 'bg-black/40 border-white/10 text-white/40 hover:border-white/30 hover:text-white/70'
              }`}
            >
              {micActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </button>

            {/* Screen Share Toggle */}
            <button
              type="button"
              onClick={() => toggleScreenPreview()}
              title={screenSharing ? 'Stop screen share' : 'Share screen'}
              className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center border transition-all ${
                screenSharing
                  ? 'bg-purple-600/30 border-purple-500 text-purple-400 shadow-[0_0_16px_rgba(168,85,247,0.4)]'
                  : 'bg-black/40 border-white/10 text-white/40 hover:border-white/30 hover:text-white/70'
              }`}
            >
              <MonitorUp className="w-5 h-5" />
            </button>

            <div className="flex-1 bg-black/40 backdrop-blur-lg border border-white/10 rounded-2xl h-14 flex items-center px-4 gap-4">
               <input
                 type="text"
                 value={input}
                 onChange={(e) => setInput(e.target.value)}
                 placeholder={micActive ? 'Listening… (or type here)' : 'Type a message…'}
                 className="bg-transparent border-none outline-none w-full text-white placeholder-white/20 font-light"
               />
               <button
                 type="submit"
                 disabled={connecting || !input.trim()}
                 className="h-10 px-6 shrink-0 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 text-white font-bold text-sm tracking-wide hover:opacity-90 transition-opacity disabled:opacity-50"
               >
                 SEND
               </button>
            </div>
          </form>
        </div>
      </div>
      </>
     )}
    </div>
  );
}
