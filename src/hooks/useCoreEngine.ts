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
import { listenCrossWindow } from '../lib/events/crossWindowEventBus';

export function useCoreEngine() {
  const [initialized, setInitialized] = useState(false);
  const geminiRef = useRef<GeminiLive | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const dummyMicStreamRef = useRef<MediaStream | null>(null);
  const modelBubbleIdRef = useRef<string>('');
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSentGreetingRef = useRef(false);

  const speechRecognitionRef = useRef<any>(null);
  const speechWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeRequestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLoggedWakeStartRef = useRef(false);
  const isWakingUpRef = useRef(false);
  const initSystemRef = useRef<(isWakeUp?: boolean, autoMic?: boolean) => void>(() => {});
  const startWakeWordListenerRef = useRef<() => void>(() => {});

  const startWakeWordListener = useCallback(() => {
    if (!useAvatarState.getState().isSleepMode) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      logger.add('warning', 'Wake Word', 'SpeechRecognition API is not supported in this environment.');
      return;
    }

    // Keep one recognizer alive and restart it between short recognition sessions.
    const existing = speechRecognitionRef.current;
    if (existing) {
      try {
        existing.start();
        return;
      } catch (e: any) {
        if (e?.name === 'InvalidStateError') return;
        try { existing.abort(); } catch (_) {}
        speechRecognitionRef.current = null;
      }
    }

    try {
      const sr = new SpeechRecognition();
      const SpeechGrammarList = (window as any).SpeechGrammarList || (window as any).webkitSpeechGrammarList;
      if (SpeechGrammarList) {
        const grammarList = new SpeechGrammarList();
        grammarList.addFromString(
          '#JSGF V1.0; grammar lucy; public <lucy> = wake up | lucy | hey lucy | hello lucy | wake up lucy ;',
          1
        );
        sr.grammars = grammarList;
      }

      sr.continuous = false;
      sr.interimResults = true;
      sr.maxAlternatives = 5;
      sr.lang = localStorage.getItem('lucy_language') || 'en-IN';

      sr.onresult = (event: any) => {
        if (isWakingUpRef.current) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          for (let j = 0; j < result.length; j++) {
            const text = result[j].transcript.toLowerCase();
            const regexStr = `\\b(wake\\s*up\\s*lucy|lucy\\s*wake\\s*up|wakeup\\s*lucy|lucy\\s*wakeup|wake\\s*up|wakeup|wake|woke\\s*up|lucy|luci|lucie|loosey|losey|lusi|lusee|look\\s*see|lucian|lucia|losie|loucy|loosy|lusy|hey\\s*lucy|hello\\s*lucy|hi\\s*lucy|ok\\s*lucy|okay\\s*lucy)\\b`;
            const match = text.match(new RegExp(regexStr, 'i'));
            if (match) {
              isWakingUpRef.current = true;
              const afterWakeWord = text.substring(match.index + match[0].length).trim();
              if (afterWakeWord.length > 2) {
                sessionStorage.setItem('lucy_pending_query', afterWakeWord);
              }
              logger.add('success', 'Wake Word', `Detected locally: "${text}"`);

              // Stop recognition immediately so the live agent can acquire the mic.
              sr.onresult = null;
              sr.onend = null;
              sr.onerror = null;
              try { sr.stop(); } catch (_) {}
              speechRecognitionRef.current = null;
              if (wakeRequestTimeoutRef.current) clearTimeout(wakeRequestTimeoutRef.current);
              wakeRequestTimeoutRef.current = setTimeout(() => {
                wakeRequestTimeoutRef.current = null;
                if (useAvatarState.getState().isSleepMode) {
                  isWakingUpRef.current = false;
                  logger.add('warning', 'Wake Word', 'Wake request timed out; restarting the voice listener.');
                  startWakeWordListenerRef.current();
                }
              }, 5000);
              import('@tauri-apps/api/core').then(({ invoke }) => {
                const tryWake = (retries = 20) => {
                  invoke('wake_up_main').catch((err) => {
                    console.warn('IPC Wake Failed, retrying...', err);
                    if (retries > 0) {
                      setTimeout(() => tryWake(retries - 1), 250);
                    } else if (useAvatarState.getState().isSleepMode) {
                      if (wakeRequestTimeoutRef.current) clearTimeout(wakeRequestTimeoutRef.current);
                      wakeRequestTimeoutRef.current = null;
                      isWakingUpRef.current = false;
                      startWakeWordListenerRef.current();
                    }
                  });
                };
                tryWake();
              }).catch((err) => {
                console.warn('Unable to load native wake command:', err);
                if (wakeRequestTimeoutRef.current) clearTimeout(wakeRequestTimeoutRef.current);
                wakeRequestTimeoutRef.current = null;
                isWakingUpRef.current = false;
                startWakeWordListenerRef.current();
              });
              return;
            }
          }
        }
      };

      const restart = (delay = 50) => {
        if (useAvatarState.getState().isSleepMode && !isWakingUpRef.current) {
          setTimeout(() => {
            if (useAvatarState.getState().isSleepMode && !isWakingUpRef.current) {
              try { sr.start(); } catch (e: any) {
                if (e?.name !== 'InvalidStateError') startWakeWordListenerRef.current();
              }
            }
          }, delay);
        }
      };

      sr.onerror = (event: any) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          logger.add('warning', 'Wake Word', `Speech listener: ${event.error || 'unknown'}`);
        }
        restart(event.error === 'no-speech' ? 50 : 1000);
      };
      sr.onstart = () => {
        if (!hasLoggedWakeStartRef.current) {
          hasLoggedWakeStartRef.current = true;
          logger.add('success', 'Wake Word', 'Microphone speech-recognition session started.');
        }
      };
      sr.onend = () => restart(50);

      if (speechWatchdogRef.current) clearInterval(speechWatchdogRef.current);
      speechWatchdogRef.current = setInterval(() => {
        if (!useAvatarState.getState().isSleepMode || isWakingUpRef.current) {
          if (speechWatchdogRef.current) clearInterval(speechWatchdogRef.current);
          speechWatchdogRef.current = null;
          return;
        }
        try { sr.abort(); } catch (_) {}
        restart(200);
      }, 60000);

      speechRecognitionRef.current = sr;
      sr.start();
      logger.add('info', 'Wake Word', 'Starting the voice wake listener.');
    } catch (e: any) {
      console.warn('[WakeWord] Speech recognition start error:', e);
      speechRecognitionRef.current = null;
      if (useAvatarState.getState().isSleepMode && !isWakingUpRef.current) {
        setTimeout(() => {
          if (useAvatarState.getState().isSleepMode && !isWakingUpRef.current) {
            startWakeWordListenerRef.current();
          }
        }, 1000);
      }
    }
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
      startWakeWordListener();
      logger.add('info', 'Sleep Mode', 'Started directly into sleep mode (Autostart).');

      // Keep a quiet stream open while the recognizer cycles between short sessions.
      navigator.mediaDevices.getUserMedia({
        audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false }
      })
        .then(stream => { dummyMicStreamRef.current = stream; })
        .catch(error => {
          logger.add('warning', 'Wake Word', `Could not keep the microphone stream open: ${error?.name || error}`);
        });

      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('enter_sleep_mode');
      });
    } else {
      initSystem();
      setInitialized(true);
    }
  }, [initSystem, startWakeWordListener]);

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

      const handleSleep = () => {
        useAvatarState.getState().setIsSleepMode(true);
        isWakingUpRef.current = false;
        geminiRef.current?.disconnect();
        playerRef.current?.stopCurrentPlayback();
        playerRef.current?.stop();
        setListening(false);
        setSpeaking(false);
        setThinking(false);
        setIsMicOn(false);

        recorderRef.current?.stop();

        // Keep the input device available as SpeechRecognition restarts.
        if (!dummyMicStreamRef.current) {
          navigator.mediaDevices.getUserMedia({
            audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false }
          }).then(stream => {
            if (useAvatarState.getState().isSleepMode) {
              dummyMicStreamRef.current = stream;
            } else {
              stream.getTracks().forEach(track => track.stop());
            }
          }).catch(error => {
            logger.add('warning', 'Wake Word', `Could not keep the microphone stream open: ${error?.name || error}`);
          });
        }

        startWakeWordListenerRef.current();
        logger.add('info', 'Sleep Mode', 'Entering low-RAM sleep mode... Say "Lucy" or "Wake up" to wake me.');
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('enter_sleep_mode');
        });
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
        if (dummyMicStreamRef.current) {
          dummyMicStreamRef.current.getTracks().forEach(track => track.stop());
          dummyMicStreamRef.current = null;
        }

        if (wakeUpTimeout) clearTimeout(wakeUpTimeout);
        
        wakeUpTimeout = setTimeout(() => {
          initSystemRef.current(true);
          setTimeout(() => {
            isWakingUpRef.current = false;
          }, 1500);
        }, 350);
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
        if (speechRecognitionRef.current) {
          try { speechRecognitionRef.current.abort(); } catch (_) {}
          speechRecognitionRef.current = null;
        }
        if (speechWatchdogRef.current) clearInterval(speechWatchdogRef.current);
        if (wakeRequestTimeoutRef.current) clearTimeout(wakeRequestTimeoutRef.current);
        if (dummyMicStreamRef.current) {
          dummyMicStreamRef.current.getTracks().forEach(track => track.stop());
          dummyMicStreamRef.current = null;
        }
      };
    }, []);

  return { initialized };
}
