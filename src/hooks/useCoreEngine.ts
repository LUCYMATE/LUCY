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
import { checkAppUpdate, markUpdateNotified } from '../lib/system/updateChecker';

export function useCoreEngine() {
  const [initialized, setInitialized] = useState(false);
  const geminiRef = useRef<GeminiLive | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const modelBubbleIdRef = useRef<string>('');
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared dummy mic stream for sleep mode
  const dummyMicStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  const startWakeWordListener = useCallback(() => {
    if (!useAvatarState.getState().isSleepMode) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    // If an instance already exists, just restart it via .start() instead of
    // creating a new one — each `new SpeechRecognition()` leaks native memory
    // in Chromium/WebView2 that isn't freed until page teardown.
    const existing = speechRecognitionRef.current;
    if (existing) {
      try { existing.start(); } catch (e) { /* already started or aborted */ }
      return;
    }

    try {
      const sr = new SpeechRecognition();
      
      const SpeechGrammarList = (window as any).SpeechGrammarList || (window as any).webkitSpeechGrammarList;
      if (SpeechGrammarList) {
        const speechRecognitionList = new SpeechGrammarList();
        const grammar = '#JSGF V1.0; grammar soltini; public <soltini> = wake up | soltini | saltini | sultini | hey soltini ;';
        speechRecognitionList.addFromString(grammar, 1);
        sr.grammars = speechRecognitionList;
      }

      sr.continuous = false; // Prevent memory leak: when true, event.results grows indefinitely until RAM maxes out
      sr.interimResults = true;
      sr.maxAlternatives = 5; // Check top 5 alternatives to catch low-confidence whispers
      sr.lang = 'en-IN';

      sr.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          for (let j = 0; j < result.length; j++) {
            const text = result[j].transcript.toLowerCase();
            const regexStr = `\\b(wake\\s*up|soltini|saltini|sultini|sholtini|sortini|soldini|zoltini|sol\\s*tiny|soul\\s*tiny|sole\\s*tiny|so\\s*tiny|cell\\s*tiny|soul\\s*teeny|sole\\s*teeny|sol\\s*teeny|salt\\s*in\\s*me|salt\\s*in\\s*e|salt\\s*and\\s*tea|soltany|sultan\\s*e|sol\\s*ti\\s*ni)\\b`;
            const match = text.match(new RegExp(regexStr, 'i'));
            if (match) {
              const afterWakeWord = text.substring(match.index + match[0].length).trim();
              if (afterWakeWord.length > 2) {
                sessionStorage.setItem('soltini_pending_query', afterWakeWord);
              }
              logger.add('success', 'Wake Word', `Detected locally: "${text}"`);
              sr.onend = null;
              sr.onerror = null;
              sr.stop();
              import('@tauri-apps/api/core').then(({ invoke }) => {
                const tryWake = (retries = 20) => {
                  invoke('wake_up_main').catch((err) => {
                    console.warn("IPC Wake Failed, retrying...", err);
                    if (retries > 0) setTimeout(() => tryWake(retries - 1), 250);
                  });
                };
                tryWake();
              });
              return;
            }
          }
        }
      };

      const restart = () => {
        if (useAvatarState.getState().isSleepMode) {
          try { sr.start(); } catch (e) { startWakeWordListener(); }
        }
      };

      sr.onerror = () => setTimeout(restart, 2000);
      sr.onend = () => setTimeout(restart, 100); // Fast restart to catch subsequent words

      // Watchdog timer: forcefully abort and restart the listener every 60 seconds.
      // This prevents Chromium's aggressive 5-minute microphone suspension and zombie API bugs.
      const watchdog = setInterval(() => {
        if (!useAvatarState.getState().isSleepMode) {
          clearInterval(watchdog);
          return;
        }
        try { sr.abort(); } catch(e) {}
        setTimeout(() => {
          if (useAvatarState.getState().isSleepMode) {
            try { sr.start(); } catch(e) {}
          }
        }, 200);
      }, 60000);

      sr.onstart = () => {
        // clear any existing watchdog? No, let the watchdog run continuously every 60s
      };

      speechRecognitionRef.current = sr;
      sr.start();
      logger.add('info', 'Sleep Mode', 'Gemini disconnected. Lightweight wake-word listener active.');
    } catch (e) {
      logger.add('warning', 'Sleep Mode', 'Speech recognition not available - wake word disabled');
    }
  }, []);

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
        playerRef.current?.stopCurrentPlayback();
        setSpeaking(false);
        modelBubbleIdRef.current = ''; 
        await recorderRef.current?.start();
        if (recorderRef.current) {
          recorderRef.current.onData = (pcm16) => {
            geminiRef.current?.sendAudio(pcm16);
          };
          recorderRef.current.onMicFrozen = () => {
            if (useAvatarState.getState().isMicOn) {
              // Toggle off then toggle back on
              toggleMicRef.current().then(() => {
                setTimeout(() => toggleMicRef.current(), 500);
              });
            }
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

  const initSystem = useCallback((isWakeUp = false, autoMic = false) => {
    logger.add('info', 'System Boot', `Initializing ${BOT_NAME}OS and Gemini connection...`);
    setInitialized(true);

    const apiKey = localStorage.getItem('soltini_main_api_key') || import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    const altApiKey = localStorage.getItem('soltini_alt_api_key') || undefined;
    
    if (!apiKey) {
      logger.add('error', 'API Key Missing', 'No API key found in Settings or .env');
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: '⚠️ Error: No Gemini API Key found. Please add one in Settings.' }]);
      return;
    }

    // Clean up any existing instances before creating new ones
    geminiRef.current?.disconnect();
    playerRef.current?.stopCurrentPlayback();
    recorderRef.current?.stop();

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
        setTimeout(async () => {
          const pendingQuery = sessionStorage.getItem('soltini_pending_query');
          const updateInfo = await checkAppUpdate();

          if (pendingQuery) {
            gemini.sendText("System instruction: The user just woke you up and said this immediately: \"" + pendingQuery + "\". Respond naturally to this query directly instead of just saying hello.");
            sessionStorage.removeItem('soltini_pending_query');
          } else if (updateInfo && updateInfo.isNewNotification) {
            markUpdateNotified(updateInfo.updateId);
            gemini.sendText(`System instruction: A brand new update for Soltini (version ${updateInfo.version}) is now available for ${updateInfo.platform}! Speak directly to the user in a cheerful, enthusiastic voice to let them know that a new update is ready, and politely tell them to check Settings to download it.`);
          } else if (!isWakeUp) {
            gemini.sendText("System instruction: The user has just booted up the application. Greet the user with a fun, casual, or slightly flirty welcome message. Keep it to one short sentence. Do not say you are an AI or acknowledge this prompt.");
          } else {
            gemini.sendText("System instruction: The user just woke you up from sleep mode. Give a fun, casual, or slightly flirty 1-sentence greeting acknowledging you are back awake and ready to help. Do not say you are an AI.");
          }
          
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
      if (useAvatarState.getState().isSleepMode) {
        setInitialized(true);
        startWakeWordListener();
        logger.add('info', 'Sleep Mode', 'Started directly into sleep mode (Autostart).');
        
        // Request dummy audio stream to keep Windows mic icon stationary
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => { dummyMicStreamRef.current = stream; })
          .catch(() => {});
          
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('enter_sleep_mode');
        });
      } else {
        initSystem();
        setInitialized(true);
      }
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


    // by moving its declaration out of the useEffect if needed, 
    // but since it's already inside the main hook body, it's accessible within this scope if we move it up.
    const handleSleep = () => {
      useAvatarState.getState().setIsSleepMode(true);
      geminiRef.current?.disconnect();
      recorderRef.current?.stop();
      playerRef.current?.stop();
      setListening(false);
      setSpeaking(false);
      setThinking(false);
      setIsMicOn(false);
      
      // Request a dummy audio stream to keep the Windows microphone icon stationary 
      // and prevent it from flashing when SpeechRecognition restarts
      navigator.mediaDevices.getUserMedia({ audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false } })
        .then(stream => { dummyMicStreamRef.current = stream; })
        .catch(() => {});

      startWakeWordListener();
      logger.add('info', 'Sleep Mode', 'Entering low-RAM sleep mode...');
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('enter_sleep_mode');
      });
    };

    let wakeUpTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleWakeUp = () => {
      useAvatarState.getState().setIsSleepMode(false);
      
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.onend = null;
        speechRecognitionRef.current.onerror = null;
        try { speechRecognitionRef.current.stop(); } catch(e) {}
      }

      if (wakeUpTimeout) clearTimeout(wakeUpTimeout);
      
      if (dummyMicStreamRef.current) {
        dummyMicStreamRef.current.getTracks().forEach(t => t.stop());
        dummyMicStreamRef.current = null;
      }
      
      wakeUpTimeout = setTimeout(() => initSystem(true), 500);
    };

    window.addEventListener('soltini-sleep', handleSleep);
    window.addEventListener('soltini-wake-up', handleWakeUp);

    return () => {
      window.removeEventListener('soltini-sleep', handleSleep);
      window.removeEventListener('soltini-wake-up', handleWakeUp);
      stopSpeakingTimer();
      geminiRef.current?.disconnect();
      recorderRef.current?.stop();
      playerRef.current?.stop();
      if (dummyMicStreamRef.current) {
        dummyMicStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [initSystem, setListening, setSpeaking, setThinking, setIsMicOn]);

  return { initialized };
}
