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

  const dummyMicStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const speechWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechActiveRef = useRef(false);
  const silenceCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startWakeWordListener = useCallback(() => {
    const triggerWake = () => {
      const isSleep = useAvatarState.getState().isSleepMode;
      logger.add('success', 'Wake Word', 'Wake command received! Activating assistant...');

      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.onend = null;
        speechRecognitionRef.current.onerror = null;
        try { speechRecognitionRef.current.stop(); } catch (_) {}
      }

      if (isSleep) {
        emitCrossWindow('lucy-wake-up');
        import('@tauri-apps/api/core').then(({ invoke }) => {
          const tryWake = (retries = 10) => {
            invoke('wake_up_main').catch((err) => {
              console.warn("IPC Wake Failed, retrying...", err);
              if (retries > 0) setTimeout(() => tryWake(retries - 1), 200);
            });
          };
          tryWake();
        }).catch(() => {});
      } else {
        if (!useAvatarState.getState().isMicOn) {
          toggleMicRef.current();
        }
      }
    };

    // Web Speech API wake-word listener (only wakes on actual spoken words)
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      return;
    }

    const existing = speechRecognitionRef.current;
    if (existing) {
      try { 
        existing.start(); 
        return;
      } catch (e: any) { 
        if (e.name === 'InvalidStateError') return;
        try { existing.abort(); } catch (_) {}
      }
    }

    try {
      const sr = new SpeechRecognition();
      
      const SpeechGrammarList = (window as any).SpeechGrammarList || (window as any).webkitSpeechGrammarList;
      if (SpeechGrammarList) {
        const speechRecognitionList = new SpeechGrammarList();
        const grammar = '#JSGF V1.0; grammar lucy; public <lucy> = wake up | wakeup | lucy | hey lucy | wakeup lucy ;';
        speechRecognitionList.addFromString(grammar, 1);
        sr.grammars = speechRecognitionList;
      }

      sr.continuous = false;
      sr.interimResults = true;
      sr.maxAlternatives = 5;
      sr.lang = 'en-US';

      sr.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          for (let j = 0; j < result.length; j++) {
            const text = result[j].transcript.toLowerCase();
            const regexStr = `\\b(wake\\s*up|wakeup|lucy|hey\\s*lucy|hello\\s*lucy|wake\\s*up\\s*lucy)\\b`;
            const match = text.match(new RegExp(regexStr, 'i'));
            if (match) {
              const afterWakeWord = text.substring(match.index + match[0].length).trim();
              if (afterWakeWord.length > 2) {
                sessionStorage.setItem('lucy_pending_query', afterWakeWord);
              }
              logger.add('success', 'Wake Word', `Detected speech: "${text}"`);
              triggerWake();
              return;
            }
          }
        }
      };

      const restart = () => {
        if (useAvatarState.getState().isSleepMode || !useAvatarState.getState().isMicOn) {
          try { sr.start(); } catch (e) { startWakeWordListener(); }
        }
      };

      sr.onerror = (event: any) => {
        if (event.error === 'no-speech') {
          setTimeout(restart, 50);
        } else {
          setTimeout(restart, 2000);
        }
      };
      sr.onend = () => setTimeout(restart, 50);

      if (speechWatchdogRef.current) {
        clearInterval(speechWatchdogRef.current);
      }

      speechWatchdogRef.current = setInterval(() => {
        if (!useAvatarState.getState().isSleepMode && useAvatarState.getState().isMicOn) {
          if (speechWatchdogRef.current) clearInterval(speechWatchdogRef.current);
          return;
        }
        try { sr.abort(); } catch(e) {}
        setTimeout(() => {
          if (useAvatarState.getState().isSleepMode || !useAvatarState.getState().isMicOn) {
            try { sr.start(); } catch(e) {
              startWakeWordListener();
            }
          }
        }, 200);
      }, 60000);

      speechRecognitionRef.current = sr;
      sr.start();
    } catch (_) {}
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
        modelBubbleIdRef.current = ''; 
        await recorderRef.current?.start();
        if (recorderRef.current) {
          recorderRef.current.onData = (pcm16, rms = 0) => {
            const isSleep = useAvatarState.getState().isSleepMode;
            const micOn = useAvatarState.getState().isMicOn;

            // When in sleep mode or when mic is off, do NOT send to Gemini
            if (isSleep || !micOn) {
              return;
            }

            geminiRef.current?.sendAudio(pcm16);

            // Client-side VAD & instant turn finalization:
            // When speech is detected, track it; when user goes silent for 650ms, endTurn() immediately.
            const SPEECH_THRESHOLD = 0.012;
            const SILENCE_TIMEOUT_MS = 650;
            const isModelSpeaking = useAvatarState.getState().isSpeaking;

            if (!isModelSpeaking) {
              if (rms > SPEECH_THRESHOLD) {
                speechActiveRef.current = true;
                if (silenceCheckTimerRef.current) {
                  clearTimeout(silenceCheckTimerRef.current);
                  silenceCheckTimerRef.current = null;
                }
              } else if (speechActiveRef.current) {
                if (!silenceCheckTimerRef.current) {
                  silenceCheckTimerRef.current = setTimeout(() => {
                    if (speechActiveRef.current && !useAvatarState.getState().isSpeaking) {
                      speechActiveRef.current = false;
                      silenceCheckTimerRef.current = null;
                      geminiRef.current?.endTurn();
                    }
                  }, SILENCE_TIMEOUT_MS);
                }
              }
            }
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
        if (silenceCheckTimerRef.current) {
          clearTimeout(silenceCheckTimerRef.current);
          silenceCheckTimerRef.current = null;
        }
        speechActiveRef.current = false;
        try { recorderRef.current?.stop(); } catch (e) {}
        try { geminiRef.current?.endTurn(); } catch (e) {}

        // Stop any dummy mic tracks so Windows OS microphone indicator disappears immediately
        if (dummyMicStreamRef.current) {
          try {
            dummyMicStreamRef.current.getTracks().forEach(track => {
              track.enabled = false;
              track.stop();
            });
          } catch (e) {}
          dummyMicStreamRef.current = null;
        }

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
    logger.add('info', 'System Boot', `Initializing ${BOT_NAME}OS and Gemini connection...`);
    setInitialized(true);

    const apiKey = localStorage.getItem('lucy_main_api_key') || import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
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
            setTimeout(() => toggleMicRef.current(), 100);
          }
        }, 100);
      }

      if (state === 'error' && detail) {
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: `⚠️ ${detail}` }]);
      }
    };

    gemini.onThinking = (thinking) => setThinking(thinking);

    gemini.onAudio = (pcmBase64) => {
      if (silenceCheckTimerRef.current) {
        clearTimeout(silenceCheckTimerRef.current);
        silenceCheckTimerRef.current = null;
      }
      speechActiveRef.current = false;
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
    geminiRef.current.sendText(trimmed);
  }, [setMessages, setSpeaking]);

  useEffect(() => {
    setEngineMethods({ initSystem, toggleMic, setMicEnabled, sendText });
  }, [initSystem, toggleMic, setMicEnabled, sendText, setEngineMethods]);

  useEffect(() => {
    if (!initialized) {
      if (useAvatarState.getState().isSleepMode) {
        setInitialized(true);
        startWakeWordListener();
        logger.add('info', 'Sleep Mode', 'Started directly into sleep mode (Autostart).');
          
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

    const unsubToggle1 = listenCrossWindow('lucy-toggle-mic', handleToggleMic);
    const unsubSet1 = listenCrossWindow<{ enabled?: boolean }>('lucy-set-mic', handleSetMic);
    const unsubMute1 = listenCrossWindow('lucy-toggle-mute', handleToggleMute);

    return () => {
      mounted = false;
      unsubToggle1();
      unsubSet1();
      unsubMute1();
    };
  }, []);

  useEffect(() => {
    const handleSleep = () => {
      useAvatarState.getState().setIsSleepMode(true);
      geminiRef.current?.disconnect();
      playerRef.current?.stopCurrentPlayback();
      playerRef.current?.stop();
      setListening(false);
      setSpeaking(false);
      setThinking(false);
      setIsMicOn(false);

      recorderRef.current?.stop();

      startWakeWordListener();
      logger.add('info', 'Sleep Mode', 'Sleeping... Say "Lucy", "Wake up", or "Wakeup" to wake me.');
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
        speechRecognitionRef.current = null;
      }

      if (speechWatchdogRef.current) {
        clearInterval(speechWatchdogRef.current);
        speechWatchdogRef.current = null;
      }

      if (wakeUpTimeout) clearTimeout(wakeUpTimeout);
      
      if (dummyMicStreamRef.current) {
        dummyMicStreamRef.current.getTracks().forEach(t => t.stop());
        dummyMicStreamRef.current = null;
      }
      
      wakeUpTimeout = setTimeout(() => initSystem(true), 150);
    };

    window.addEventListener('lucy-sleep', handleSleep);
    window.addEventListener('lucy-wake-up', handleWakeUp);

    return () => {
      window.removeEventListener('lucy-sleep', handleSleep);
      window.removeEventListener('lucy-wake-up', handleWakeUp);
      stopSpeakingTimer();
      geminiRef.current?.disconnect();
      recorderRef.current?.stop();
      playerRef.current?.stop();
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch (_) {}
      }
      if (dummyMicStreamRef.current) {
        dummyMicStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [initSystem, setListening, setSpeaking, setThinking, setIsMicOn]);

  return { initialized };
}
