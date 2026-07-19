import { useEffect, useRef, useState, useCallback } from 'react';
import { GeminiLive } from '../lib/gemini/gemini-live';
import { AudioRecorder } from '../lib/audio/audio-recorder';
import { AudioPlayer } from '../lib/audio/audio-player';
import { logger } from '../lib/store/logger';
import { useAvatarState } from '../lib/store/avatarState';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '../lib/store/chatStore';
import { BOT_NAME } from '../config/bot-profile';
import { chatHistory } from '../lib/store/chatHistory';
import { useEngineStore } from '../lib/store/engineStore';
import { listen } from '@tauri-apps/api/event';

export function useCoreEngine() {
  const [initialized, setInitialized] = useState(false);
  const geminiRef = useRef<GeminiLive | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const modelBubbleIdRef = useRef<string>('');
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMicPendingRef = useRef(false);

  const { setSpeaking, setThinking, setListening, setEmotion, setIsMicOn, setConnectionState } = useAvatarState(useShallow(s => ({
    setSpeaking: s.setSpeaking,
    setThinking: s.setThinking,
    setListening: s.setListening,
    setEmotion: s.setEmotion,
    setIsMicOn: s.setIsMicOn,
    setConnectionState: s.setConnectionState
  })));

  const { messages, activeChatId, setMessages } = useChatStore();
  const setEngineMethods = useEngineStore(s => s.setEngineMethods);

  // Auto-save logic
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      chatHistory.saveChat(activeChatId, messages);
    }, 500);
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

  const toggleMic = async () => {
    if (isMicPendingRef.current) return; 

    const currentMicOn = useAvatarState.getState().isMicOn;

    if (!currentMicOn) {
      isMicPendingRef.current = true;
      try {
        logger.add('info', 'User Action', 'Toggled microphone ON');
        playerRef.current?.stopCurrentPlayback();
        setSpeaking(false);
        modelBubbleIdRef.current = ''; 
        await recorderRef.current?.start();
        if (recorderRef.current) {
          recorderRef.current.onData = (pcm16) => {
            geminiRef.current?.sendAudio(pcm16);
          };
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
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: '⚠️ Microphone access denied or unavailable.' }]);
        setListening(false);
        setIsMicOn(false);
      } finally {
        isMicPendingRef.current = false;
      }
    } else {
      isMicPendingRef.current = true;
      try {
        logger.add('info', 'User Action', 'Toggled microphone OFF');
        try { recorderRef.current?.stop(); } catch (e) {}
        try { geminiRef.current?.endTurn(); } catch (e) {}
        setListening(false);
        setIsMicOn(false);
      } finally {
        isMicPendingRef.current = false;
      }
    }
  };

  const toggleMicRef = useRef(toggleMic);
  toggleMicRef.current = toggleMic;

  const initSystem = useCallback((autoMic = false) => {
    logger.add('info', 'System Boot', `Initializing ${BOT_NAME}OS and Gemini connection...`);
    setInitialized(true);

    const apiKey = localStorage.getItem('soltini_main_api_key') || import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    const altApiKey = localStorage.getItem('soltini_alt_api_key') || undefined;
    
    if (!apiKey) {
      logger.add('error', 'API Key Missing', 'No API key found in Settings or .env');
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: '⚠️ Error: No Gemini API Key found. Please add one in Settings.' }]);
      return;
    }

    const gemini = new GeminiLive();
    const player = new AudioPlayer();
    const recorder = new AudioRecorder();

    geminiRef.current = gemini;
    playerRef.current = player;
    recorderRef.current = recorder;

    player.start();

    let hasSentGreeting = false;
    gemini.onStateChange = (state, detail) => {
      setConnectionState(state);

      if (state === 'connected' && !hasSentGreeting) {
        hasSentGreeting = true;
        setTimeout(() => {
          gemini.sendText("System instruction: The user has just booted up the application. Greet the user with a fun, casual, or slightly flirty welcome message. Keep it to one short sentence. Do not say you are an AI or acknowledge this prompt.");
          
          const autoMicStr = localStorage.getItem('soltini_auto_mic');
          const shouldAutoMic = autoMicStr === null ? true : autoMicStr === 'true';
          
          if (shouldAutoMic) {
            setTimeout(() => toggleMicRef.current(), 500);
          }
        }, 1000);
      }

      if (state === 'error' && detail) {
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: `⚠️ ${detail}` }]);
      }
    };

    gemini.onThinking = (thinking) => setThinking(thinking);

    gemini.onAudio = (pcmBase64) => {
      setSpeaking(true);
      player.playChunk(pcmBase64);
      resetSpeakingTimer(player.getRemainingTime());
    };

    gemini.onTranscript = (text, isInput) => {
      setThinking(false);
      if (isInput) {
        modelBubbleIdRef.current = ''; 
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text }]);
      } else {
        const emotionRegex = /\[(happy|sad|angry|surprised|thinking|neutral)\]/i;
        const match = text.match(emotionRegex);
        let cleanText = text;
        if (match) {
          const matchedEmotion = match[1].toLowerCase() as any;
          setEmotion(matchedEmotion);
          cleanText = text.replace(emotionRegex, '').trim();
        }

        if (!cleanText) return; 

        let existingId = modelBubbleIdRef.current;
        if (!existingId) {
          existingId = crypto.randomUUID();
          modelBubbleIdRef.current = existingId;
          setMessages(prev => [...prev, { id: existingId, role: 'model', text: cleanText }]);
        } else {
          setMessages(prev => prev.map(m => m.id === existingId ? { ...m, text: m.text + cleanText } : m));
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
      setTimeout(() => toggleMicRef.current(), 100);
    }
  }, [setMessages, resetSpeakingTimer, setConnectionState, setSpeaking, setThinking, setEmotion]);

  const sendText = (text: string) => {
    if (!geminiRef.current?.isReady()) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: '⚠️ Not connected yet.' }]);
      return;
    }
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text }]);
    modelBubbleIdRef.current = ''; 
    playerRef.current?.stopCurrentPlayback();
    setSpeaking(false);
    geminiRef.current.sendText(text);
  };

  useEffect(() => {
    setEngineMethods({ initSystem, toggleMic, sendText });
  }, [initSystem, toggleMic, sendText, setEngineMethods]);

  useEffect(() => {
    if (!initialized) {
      initSystem();
    }
  }, [initialized, initSystem]);

  useEffect(() => {
    const handleSettingsChanged = () => {
      if (initialized) {
        logger.add('info', 'System Reconnect', 'Settings changed. Reconnecting core...');
        geminiRef.current?.disconnect();
        recorderRef.current?.stop();
        playerRef.current?.stop();
        setListening(false);
        setIsMicOn(false);
        setSpeaking(false);
        setThinking(false);
        modelBubbleIdRef.current = '';
        setTimeout(() => initSystem(), 800);
      }
    };
    window.addEventListener('soltini-core-settings-changed', handleSettingsChanged);
    return () => window.removeEventListener('soltini-core-settings-changed', handleSettingsChanged);
  }, [initialized, initSystem, setListening, setIsMicOn, setSpeaking, setThinking]);

  useEffect(() => {
    let mounted = true;
    const fns: (() => void)[] = [];
    listen('soltini-toggle-mic', () => { if (mounted) toggleMicRef.current(); }).then(fn => { if (mounted) fns.push(fn); else fn(); });
    listen('soltini-toggle-mute', () => { if (mounted) playerRef.current?.setMuted(!(playerRef.current as any)?.isMuted); }).then(fn => { if (mounted) fns.push(fn); else fn(); });
    return () => {
      mounted = false;
      fns.forEach(fn => fn());
    };
  }, []);

  useEffect(() => {
    return () => {
      stopSpeakingTimer();
      geminiRef.current?.disconnect();
      recorderRef.current?.stop();
      playerRef.current?.stop();
    };
  }, []);

  return { initialized };
}
