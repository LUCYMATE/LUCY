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
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { checkAppUpdate, markUpdateNotified } from '../lib/system/updateChecker';
import { emitCrossWindow, listenCrossWindow } from '../lib/events/crossWindowEventBus';

export function useCoreEngine() {
  const [initialized, setInitialized] = useState(false);
  const geminiRef = useRef<GeminiLive | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const modelBubbleIdRef = useRef<string>('');
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSentGreetingRef = useRef(false);

  const wakeRequestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeWakeActiveRef = useRef(false);
  const isWakingUpRef = useRef(false);
  const initSystemRef = useRef<(isWakeUp?: boolean, autoMic?: boolean) => void>(() => {});
  const startWakeWordListenerRef = useRef<() => void>(() => {});

  const requestWake = useCallback((text: string) => {
    if (!useAvatarState.getState().isSleepMode || isWakingUpRef.current) return;
    isWakingUpRef.current = true;
    nativeWakeActiveRef.current = false;
    const matcher = /\b(wake\s*up\s*lucy|lucy\s*wake\s*up|wakeup\s*lucy|lucy\s*wakeup|wake\s*up|wakeup|wake|woke\s*up|lucy|luci|lucie|loosey|losey|lusi|lusee|look\s*see|lucian|lucia|losie|loucy|loosy|lusy|hey\s*lucy|hello\s*lucy|hi\s*lucy|ok\s*lucy|okay\s*lucy)\b/i;
    const match = text.match(matcher);
    const pendingQuery = match ? text.slice((match.index || 0) + match[0].length).trim() : '';
    if (pendingQuery.length > 2) sessionStorage.setItem('lucy_pending_query', pendingQuery);
    logger.add('success', 'Wake Word', `Detected: "${text}"`);
    void invoke('stop_native_wake_listener').catch(() => {});
    if (wakeRequestTimeoutRef.current) clearTimeout(wakeRequestTimeoutRef.current);
    wakeRequestTimeoutRef.current = setTimeout(() => {
      wakeRequestTimeoutRef.current = null;
      if (useAvatarState.getState().isSleepMode) {
        isWakingUpRef.current = false;
        startWakeWordListenerRef.current();
      }
    }, 7000);

    // Immediately wake up state in frontend
    useAvatarState.getState().setIsSleepMode(false);
    emitCrossWindow('lucy-wake-up');

    const tryWake = (retries = 20) => {
      invoke('wake_up_main').catch((error) => {
        if (retries > 0) setTimeout(() => tryWake(retries - 1), 250);
        else logger.add('error', 'Wake Word', `Could not restore the main window: ${String(error)}`);
      });
    };
    tryWake();
  }, []);

  const startWakeWordListener = useCallback(() => {
    if (!useAvatarState.getState().isSleepMode || isWakingUpRef.current) return;
    if (nativeWakeActiveRef.current) return;
    nativeWakeActiveRef.current = true;
    const deviceId = localStorage.getItem('lucy_mic_id') || 'default';
    invoke('start_native_wake_listener', { deviceId }).then(() => {
      logger.add('info', 'Wake Word', 'Starting the local Rust wake-word detector.');
    }).catch((error) => {
      nativeWakeActiveRef.current = false;
      logger.add('error', 'Wake Word', `Could not start local detector: ${String(error)}`);
    });
  }, []);

  const isMicPendingRef = useRef(false);
  const lastToggleTimeRef = useRef<number>(0);

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

  const interruptSpeech = useCallback(() => {
    playerRef.current?.stopCurrentPlayback();
    setSpeaking(false);
    stopSpeakingTimer();
    modelBubbleIdRef.current = '';
  }, [setSpeaking]);

  const setMicEnabled = async (targetOn: boolean) => {
    const currentMicOn = useAvatarState.getState().isMicOn;
    if (currentMicOn === targetOn) return;
    await toggleMic();
  };

  const toggleMic = async () => {
    const now = Date.now();
    if (now - lastToggleTimeRef.current < 400) {
      return;
    }
    if (isMicPendingRef.current) return;
    lastToggleTimeRef.current = now;

    const currentMicOn = useAvatarState.getState().isMicOn;

    if (!currentMicOn) {
      isMicPendingRef.current = true;
      try {
        playerRef.current?.stopCurrentPlayback();
        setSpeaking(false);
        stopSpeakingTimer();
        modelBubbleIdRef.current = ''; 
        await recorderRef.current?.start();
        if (recorderRef.current) {
          recorderRef.current.onData = (pcm16) => {
            const isSleep = useAvatarState.getState().isSleepMode;
            const micOn = useAvatarState.getState().isMicOn;
            if (isSleep || !micOn) return;

            // Prevent speaker echo: when Lucy is speaking or playing audio from speakers,
            // do NOT feed speaker sound back into Gemini
            if (useAvatarState.getState().isSpeaking || playerRef.current?.isPlaying()) {
              return;
            }

            geminiRef.current?.sendAudio(pcm16);
          };
          recorderRef.current.onMicFrozen = () => {
            if (useAvatarState.getState().isMicOn) {
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
        const help = navigator.userAgent.includes('Windows')
          ? ' Check Windows Settings → Privacy & security → Microphone and allow desktop apps to access it.'
          : '';
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: `⚠️ Microphone is unavailable or blocked.${help}` }]);
        setListening(false);
        setIsMicOn(false);
      } finally {
        isMicPendingRef.current = false;
      }
    } else {
      isMicPendingRef.current = true;
      try {
        try { recorderRef.current?.stop(); } catch (e) {}

        // Descending tone for clear mute feedback
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(900, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(450, ctx.currentTime + 0.1);
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.1);
          setTimeout(() => ctx.close(), 200);
        } catch(e) {}

        setListening(false);
        setIsMicOn(false);
      } finally {
        isMicPendingRef.current = false;
      }
    }
  };

  const toggleMicRef = useRef(toggleMic);
  toggleMicRef.current = toggleMic;

  const setMicEnabledRef = useRef(setMicEnabled);
  setMicEnabledRef.current = setMicEnabled;

  const initSystem = useCallback((isWakeUp = false, autoMic = false) => {
    if (!isWakeUp && geminiRef.current?.isReady()) {
      logger.add('info', 'System Boot', 'Gemini connection already active.');
      return;
    }
    logger.add('info', 'System Boot', `Initializing ${BOT_NAME}OS and Gemini connection...`);
    setInitialized(true);

    const apiKey = localStorage.getItem('lucy_main_api_key') || undefined;
    const altApiKey = localStorage.getItem('lucy_alt_api_key') || undefined;
    
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

    if (isWakeUp) {
      hasSentGreetingRef.current = false;
    }

    gemini.onStateChange = (state, detail) => {
      setConnectionState(state);

      if (state === 'connected' && !hasSentGreetingRef.current) {
        hasSentGreetingRef.current = true;
        setTimeout(() => {
          const pendingQuery = sessionStorage.getItem('lucy_pending_query');

          if (pendingQuery) {
            sessionStorage.removeItem('lucy_pending_query');
            gemini.sendText("System instruction: The user just woke you up and said this immediately: \"" + pendingQuery + "\". Respond naturally to this query directly instead of just saying hello.");
          } else if (!isWakeUp) {
            // Check update in background without blocking initial welcome greeting
            checkAppUpdate().then(updateInfo => {
              if (updateInfo && updateInfo.isNewNotification) {
                markUpdateNotified(updateInfo.updateId);
                gemini.sendText(`System instruction: A brand new update for LUCY (version ${updateInfo.version}) is now available for ${updateInfo.platform}! Speak directly to the user in a cheerful, enthusiastic voice to let them know that a new update is ready, and politely tell them to check Settings to download it.`);
              }
            }).catch(() => {});
            gemini.sendText("System instruction: The user has just booted up the application. Greet the user with a fun, casual, or slightly flirty welcome message. Keep it to one short sentence. Do not say you are an AI or acknowledge this prompt.");
          } else {
            gemini.sendText("System instruction: The user just woke you up from sleep mode. Give a fun, casual, or slightly flirty 1-sentence greeting acknowledging you are back awake and ready to help. Do not say you are an AI.");
          }
          
          const autoMicStr = localStorage.getItem('lucy_auto_mic');
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
      setTimeout(() => toggleMicRef.current(), 500);
    }
  }, [setMessages, resetSpeakingTimer, setConnectionState, setSpeaking, setThinking, setEmotion]);

  const lastSentRef = useRef<{ text: string; time: number }>({ text: '', time: 0 });

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Deduplication check: drop duplicate send requests within 400ms
    const now = performance.now();
    if (trimmed === lastSentRef.current.text && now - lastSentRef.current.time < 400) {
      console.warn('[useCoreEngine] Dropped duplicate sendText:', trimmed);
      return;
    }
    lastSentRef.current = { text: trimmed, time: now };

    if (!geminiRef.current?.isReady()) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: '⚠️ Not connected yet.' }]);
      return;
    }
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text: trimmed }]);
    modelBubbleIdRef.current = ''; 
    playerRef.current?.stopCurrentPlayback();
    setSpeaking(false);
    stopSpeakingTimer();
    geminiRef.current.sendText(trimmed);
  }, [setMessages, setSpeaking]);

  useEffect(() => {
    setEngineMethods({ initSystem, toggleMic, setMicEnabled, sendText, interruptSpeech });
  }, [initSystem, toggleMic, setMicEnabled, sendText, interruptSpeech, setEngineMethods]);

  // Global Escape key: instantly interrupt Lucy whenever she is speaking
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useAvatarState.getState().isSpeaking) {
        interruptSpeech();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [interruptSpeech]);

  const bootInitDoneRef = useRef(false);

  useEffect(() => {
    if (bootInitDoneRef.current) return;
    bootInitDoneRef.current = true;

    if (useAvatarState.getState().isSleepMode) {
      setInitialized(true);
      logger.add('info', 'Sleep Mode', 'Started directly into sleep mode (Autostart).');
      setTimeout(() => {
        startWakeWordListenerRef.current();
        invoke('enter_sleep_mode');
      }, 250);
    } else {
      initSystem();
      setInitialized(true);
    }
  }, [initSystem, startWakeWordListener]);

  useEffect(() => {
    let unlistenWake: UnlistenFn | null = null;
    let unlistenWakeError: UnlistenFn | null = null;
    let unlistenWakeStatus: UnlistenFn | null = null;
    let disposed = false;
    void listen<string>('native-wake-detected', ({ payload }) => {
      requestWake(payload);
    }).then((unlisten) => {
      if (disposed) unlisten(); else unlistenWake = unlisten;
    });
    void listen<string>('native-wake-status', ({ payload }) => {
      if (payload.startsWith('listening')) {
        logger.add('success', 'Wake Word', `Local detector active: ${payload}`);
      } else if (payload.includes('unavailable')) {
        logger.add('warning', 'Wake Word', payload);
      }
    }).then((unlisten) => {
      if (disposed) unlisten(); else unlistenWakeStatus = unlisten;
    });
    void listen<string>('native-wake-error', ({ payload }) => {
      nativeWakeActiveRef.current = false;
      logger.add('error', 'Wake Word', payload);
      if (useAvatarState.getState().isSleepMode && !isWakingUpRef.current) {
        setTimeout(() => startWakeWordListenerRef.current(), 5000);
      }
    }).then((unlisten) => {
      if (disposed) unlisten(); else unlistenWakeError = unlisten;
    });
    return () => {
      disposed = true;
      unlistenWake?.();
      unlistenWakeError?.();
      unlistenWakeStatus?.();
    };
  }, [requestWake]);

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
    const unsub = listenCrossWindow('lucy-core-settings-changed', handleSettingsChanged);
    return () => {
      unsub();
    };
  }, [initialized, initSystem, setListening, setIsMicOn, setSpeaking, setThinking]);

  useEffect(() => {
    let mounted = true;
    const handleToggleMic = () => { if (mounted) toggleMicRef.current(); };
    const handleSetMic = (payload: any) => {
      if (!mounted) return;
      if (payload && typeof payload.enabled === 'boolean') {
        setMicEnabledRef.current(payload.enabled);
      } else {
        toggleMicRef.current();
      }
    };
    const handleToggleMute = () => {
      if (mounted) playerRef.current?.setMuted(!(playerRef.current as any)?.isMuted);
    };
    const handleBoostChange = (payload: any) => {
      if (mounted && payload?.boost && recorderRef.current) {
        recorderRef.current.setMicBoost(payload.boost);
      }
    };

    const unsubToggle1 = listenCrossWindow('lucy-toggle-mic', handleToggleMic);
    const unsubSet1 = listenCrossWindow<{ enabled?: boolean }>('lucy-set-mic', handleSetMic);
    const unsubMute1 = listenCrossWindow('lucy-toggle-mute', handleToggleMute);
    const unsubBoost1 = listenCrossWindow<{ boost?: number }>('lucy-mic-boost-changed', handleBoostChange);

    return () => {
      mounted = false;
      unsubToggle1();
      unsubSet1();
      unsubMute1();
      unsubBoost1();
    };
  }, []);

  useEffect(() => {
      initSystemRef.current = initSystem;
      startWakeWordListenerRef.current = startWakeWordListener;

      const handleSleep = async () => {
        useAvatarState.getState().setIsSleepMode(true);
        isWakingUpRef.current = false;
        geminiRef.current?.disconnect();
        playerRef.current?.stopCurrentPlayback();
        playerRef.current?.stop();
        setListening(false);
        setSpeaking(false);
        setThinking(false);
        setIsMicOn(false);

        await recorderRef.current?.stopAndWait();
        nativeWakeActiveRef.current = false;
        await invoke('stop_native_wake_listener').catch(() => {});
        startWakeWordListenerRef.current();
        logger.add('info', 'Sleep Mode', 'Entering low-RAM sleep mode... Say "Lucy" or "Wake up" to wake me.');
        invoke('enter_sleep_mode');
      };

      let lastWakeUpTime = 0;
      let wakeUpTimeout: ReturnType<typeof setTimeout> | null = null;
      const handleWakeUp = () => {
        const now = Date.now();
        if (now - lastWakeUpTime < 1000) {
          return;
        }
        lastWakeUpTime = now;

        useAvatarState.getState().setIsSleepMode(false);
        if (wakeRequestTimeoutRef.current) {
          clearTimeout(wakeRequestTimeoutRef.current);
          wakeRequestTimeoutRef.current = null;
        }

        nativeWakeActiveRef.current = false;

        if (wakeUpTimeout) clearTimeout(wakeUpTimeout);
        void (async () => {
          await invoke('stop_native_wake_listener').catch(() => {});
          wakeUpTimeout = setTimeout(() => {
            initSystemRef.current(true);
            setTimeout(() => {
              isWakingUpRef.current = false;
            }, 1500);
          }, 350);
        })();
      };

      const unsubSleep = listenCrossWindow('lucy-sleep', handleSleep);
      const unsubWake = listenCrossWindow('lucy-wake-up', handleWakeUp);

      return () => {
        unsubSleep();
        unsubWake();
        stopSpeakingTimer();
        geminiRef.current?.disconnect();
        recorderRef.current?.stop();
        playerRef.current?.stop();
        nativeWakeActiveRef.current = false;
        void invoke('stop_native_wake_listener').catch(() => {});
        if (wakeRequestTimeoutRef.current) clearTimeout(wakeRequestTimeoutRef.current);
      };
    }, []);

  return { initialized };
}
