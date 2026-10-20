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

export type WakeDebugLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface WakeDebugSnapshot {
  detectorStatus: string;
  audioRms: number;
  audioPeak: number;
  audioAgeMs: number | null;
  sampleRate: number | null;
  channels: number | null;
  audioChunks: number;
  droppedChunks: number;
  scores: Record<'Lucy' | 'Hey Lucy', number>;
  lastWakeAt: number | null;
  events: Array<{ at: number; level: WakeDebugLogLevel; message: string }>;
}

export interface WakeDebugTelemetry {
  kind: 'audio' | 'score';
  phrase?: 'Lucy' | 'Hey Lucy';
  rms?: number;
  peak?: number;
  audioAgeMs?: number;
  sampleRate?: number;
  channels?: number;
  audioChunks?: number;
  droppedChunks?: number;
  score?: number;
  smoothed?: number;
  threshold?: number;
  smoothedThreshold?: number;
}

const initialWakeDebug: WakeDebugSnapshot = {
  detectorStatus: 'Waiting for sleep mode',
  audioRms: 0,
  audioPeak: 0,
  audioAgeMs: null,
  sampleRate: null,
  channels: null,
  audioChunks: 0,
  droppedChunks: 0,
  scores: { Lucy: 0, 'Hey Lucy': 0 },
  lastWakeAt: null,
  events: [],
};

export function useCoreEngine() {
  const [initialized, setInitialized] = useState(false);
  const [wakeDebug, setWakeDebug] = useState<WakeDebugSnapshot>(initialWakeDebug);
  const geminiRef = useRef<GeminiLive | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const modelBubbleIdRef = useRef<string>('');
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSentGreetingRef = useRef(false);

  const wakeRequestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeWakeActiveRef = useRef(false);
  const nativeWakeEventsReadyRef = useRef(false);
  const nativeWakeListenerCountRef = useRef(0);
  const isWakingUpRef = useRef(false);
  const initSystemRef = useRef<(isWakeUp?: boolean, autoMic?: boolean) => void>(() => {});
  const startWakeWordListenerRef = useRef<() => void>(() => {});

  const addWakeDebugEvent = useCallback((level: WakeDebugLogLevel, message: string) => {
    setWakeDebug((current) => ({
      ...current,
      events: [{ at: Date.now(), level, message }, ...current.events].slice(0, 30),
    }));
  }, []);

  const requestWake = useCallback((text: string) => {
    if (isWakingUpRef.current) return;
    isWakingUpRef.current = true;
    nativeWakeActiveRef.current = false;
    setWakeDebug((current) => ({
      ...current,
      detectorStatus: `Wake phrase detected: ${text}`,
      lastWakeAt: Date.now(),
      events: [{ at: Date.now(), level: 'success' as const, message: `Wake event reached UI: ${text}` }, ...current.events].slice(0, 30),
    }));
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
      invoke('wake_up_main').then(() => {
        addWakeDebugEvent('success', 'Window restore command completed.');
      }).catch((error) => {
        if (retries > 0) setTimeout(() => tryWake(retries - 1), 250);
        else {
          setWakeDebug((current) => ({ ...current, detectorStatus: `Window restore failed: ${String(error)}` }));
          addWakeDebugEvent('error', `Could not restore the main window: ${String(error)}`);
          logger.add('error', 'Wake Word', `Could not restore the main window: ${String(error)}`);
        }
      });
    };
    tryWake();
  }, [addWakeDebugEvent]);

  const startWakeWordListener = useCallback(() => {
    if (!useAvatarState.getState().isSleepMode || isWakingUpRef.current) return;
    // Native startup errors/status are emitted immediately by Rust. Do not start
    // the worker until the UI has subscribed, or the only useful failure detail
    // can be lost and the panel will look like the microphone is simply idle.
    if (!nativeWakeEventsReadyRef.current) {
      setWakeDebug((current) => ({ ...current, detectorStatus: 'Waiting for wake diagnostics to connect…' }));
      return;
    }
    if (nativeWakeActiveRef.current) return;
    nativeWakeActiveRef.current = true;
    setWakeDebug((current) => ({
      ...current,
      detectorStatus: 'Starting native detector…',
      audioRms: 0,
      audioPeak: 0,
      audioAgeMs: null,
      sampleRate: null,
      channels: null,
      audioChunks: 0,
      droppedChunks: 0,
      scores: { Lucy: 0, 'Hey Lucy': 0 },
    }));
    addWakeDebugEvent('info', 'Requested native detector startup.');
    const deviceId = localStorage.getItem('lucy_mic_id') || 'default';
    invoke('start_native_wake_listener', { deviceId }).then(() => {
      logger.add('info', 'Wake Word', 'Starting the local Rust wake-word detector.');
    }).catch((error) => {
      nativeWakeActiveRef.current = false;
      setWakeDebug((current) => ({ ...current, detectorStatus: `Start failed: ${String(error)}` }));
      addWakeDebugEvent('error', `Start command failed: ${String(error)}`);
      logger.add('error', 'Wake Word', `Could not start local detector: ${String(error)}`);
    });
  }, [addWakeDebugEvent]);

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

  const setMicEnabled = async (targetOn: boolean, preservePlayback = false) => {
    const currentMicOn = useAvatarState.getState().isMicOn;
    const isCapturing = recorderRef.current?.isActive() ?? false;
    if (currentMicOn === targetOn && isCapturing === targetOn) return;
    await toggleMic(preservePlayback, targetOn);
  };

  const toggleMic = async (preservePlayback = false, forceState?: boolean) => {
    const now = Date.now();
    if (forceState === undefined && now - lastToggleTimeRef.current < 250) {
      return;
    }
    if (isMicPendingRef.current) return;
    lastToggleTimeRef.current = now;

    const currentMicOn = useAvatarState.getState().isMicOn;
    const targetOn = forceState !== undefined ? forceState : !currentMicOn;

    if (targetOn) {
      isMicPendingRef.current = true;
      try {
        if (!preservePlayback) {
          playerRef.current?.stopCurrentPlayback();
          setSpeaking(false);
          stopSpeakingTimer();
          modelBubbleIdRef.current = ''; 
        }
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
              setMicEnabledRef.current(false).then(() => {
                setTimeout(() => setMicEnabledRef.current(true, true), 500);
              });
            }
          };
          if (!preservePlayback) {
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
        }
        setListening(true);
        setIsMicOn(true);
        logger.add('success', 'Microphone', 'Microphone active and listening.');
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
        try { await recorderRef.current?.stopAndWait(); } catch (e) {}

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
        logger.add('info', 'Microphone', 'Microphone muted.');
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
    setListening(false);
    setIsMicOn(false);

    const gemini = new GeminiLive();
    const player = new AudioPlayer();
    const recorder = recorderRef.current || new AudioRecorder();

    geminiRef.current = gemini;
    playerRef.current = player;
    recorderRef.current = recorder;

    player.start();

    if (isWakeUp) {
      hasSentGreetingRef.current = false;
    }

    gemini.onStateChange = (state, detail) => {
      setConnectionState(state);
      if (isWakeUp || useAvatarState.getState().isSleepMode) {
        const level: WakeDebugLogLevel = state === 'error'
          ? 'error'
          : state === 'connected' ? 'success' : 'info';
        const detailText = detail ? `: ${String(detail)}` : '';
        addWakeDebugEvent(level, `Assistant connection ${state}${detailText}`);
      }

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
          
          if (isWakeUp || shouldAutoMic) {
            setTimeout(() => {
              void setMicEnabledRef.current(true, true);
            }, 300);
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

    const autoMicSetting = localStorage.getItem('lucy_auto_mic');
    const isAutoMicOn = autoMicSetting === null ? true : autoMicSetting === 'true';

    if (autoMic || isWakeUp || isAutoMicOn) {
      setTimeout(() => {
        void setMicEnabledRef.current(true, true);
      }, 500);
    }
  }, [addWakeDebugEvent, setMessages, resetSpeakingTimer, setConnectionState, setSpeaking, setThinking, setEmotion]);

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

    // If Lucy is currently in sleep mode, wake her up so she can converse!
    if (useAvatarState.getState().isSleepMode) {
      useAvatarState.getState().setIsSleepMode(false);
      emitCrossWindow('lucy-wake-up');
    }

    if (!geminiRef.current?.isReady()) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', text: trimmed }]);
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: 'Connecting to Gemini Live…' }]);
      initSystemRef.current(true, true);
      setTimeout(() => {
        if (geminiRef.current?.isReady()) {
          geminiRef.current.sendText(trimmed);
        }
      }, 1500);
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
    let unlistenWakeDebug: UnlistenFn | null = null;
    let disposed = false;
    nativeWakeEventsReadyRef.current = false;
    nativeWakeListenerCountRef.current = 0;
    const markWakeListenerReady = () => {
      nativeWakeListenerCountRef.current += 1;
      if (nativeWakeListenerCountRef.current === 4) {
        nativeWakeEventsReadyRef.current = true;
        addWakeDebugEvent('success', 'Native wake diagnostics connected.');
        if (useAvatarState.getState().isSleepMode) startWakeWordListenerRef.current();
      }
    };
    void listen<string>('native-wake-detected', ({ payload }) => {
      setWakeDebug((current) => ({
        ...current,
        detectorStatus: `Detector fired: ${payload}; waking window…`,
        lastWakeAt: Date.now(),
        events: [{ at: Date.now(), level: 'success' as const, message: `Detector fired for “${payload}”.` }, ...current.events].slice(0, 30),
      }));
      requestWake(payload);
    }).then((unlisten) => {
      if (disposed) unlisten(); else unlistenWake = unlisten;
      if (!disposed) markWakeListenerReady();
    });
    void listen<string>('native-wake-status', ({ payload }) => {
      setWakeDebug((current) => ({
        ...current,
        detectorStatus: payload === 'stopped' && (
          current.detectorStatus.startsWith('Error:')
          || (!useAvatarState.getState().isSleepMode && current.lastWakeAt !== null)
        ) ? current.detectorStatus : payload,
      }));
      if (payload === 'stopped') {
        addWakeDebugEvent(
          useAvatarState.getState().isSleepMode ? 'warning' : 'info',
          useAvatarState.getState().isSleepMode ? 'Native detector stopped while still asleep.' : 'Native detector shut down after wake.',
        );
      }
      if (payload.startsWith('listening')) {
        addWakeDebugEvent('success', `Detector ready: ${payload}`);
        logger.add('success', 'Wake Word', `Local detector active: ${payload}`);
      } else if (payload.includes('unavailable')) {
        addWakeDebugEvent('warning', payload);
        logger.add('warning', 'Wake Word', payload);
      }
    }).then((unlisten) => {
      if (disposed) unlisten(); else unlistenWakeStatus = unlisten;
      if (!disposed) markWakeListenerReady();
    });
    void listen<WakeDebugTelemetry>('native-wake-debug', ({ payload }) => {
      if (payload.kind === 'audio') {
        setWakeDebug((current) => ({
          ...current,
          audioRms: payload.rms ?? current.audioRms,
          audioPeak: payload.peak ?? current.audioPeak,
          audioAgeMs: payload.audioAgeMs ?? current.audioAgeMs,
          sampleRate: payload.sampleRate ?? current.sampleRate,
          channels: payload.channels ?? current.channels,
          audioChunks: payload.audioChunks ?? current.audioChunks,
          droppedChunks: payload.droppedChunks ?? current.droppedChunks,
        }));
      } else if (payload.kind === 'score' && payload.phrase) {
        setWakeDebug((current) => ({
          ...current,
          scores: { ...current.scores, [payload.phrase!]: payload.smoothed ?? payload.score ?? 0 },
        }));
      }
    }).then((unlisten) => {
      if (disposed) unlisten(); else unlistenWakeDebug = unlisten;
      if (!disposed) markWakeListenerReady();
    });
    void listen<string>('native-wake-error', ({ payload }) => {
      nativeWakeActiveRef.current = false;
      setWakeDebug((current) => ({ ...current, detectorStatus: `Error: ${payload}` }));
      addWakeDebugEvent('error', payload);
      logger.add('error', 'Wake Word', payload);
      if (useAvatarState.getState().isSleepMode && !isWakingUpRef.current) {
        addWakeDebugEvent('warning', 'Retry scheduled in 5 seconds.');
        setTimeout(() => startWakeWordListenerRef.current(), 5000);
      }
    }).then((unlisten) => {
      if (disposed) unlisten(); else unlistenWakeError = unlisten;
      if (!disposed) markWakeListenerReady();
    });
    return () => {
      disposed = true;
      nativeWakeEventsReadyRef.current = false;
      unlistenWake?.();
      unlistenWakeError?.();
      unlistenWakeStatus?.();
      unlistenWakeDebug?.();
    };
  }, [addWakeDebugEvent, requestWake]);

  // The sleep event is broadcast across windows and can race hook mounting.
  // Reconcile directly from the shared sleep state as a backstop so the native
  // listener always starts when Lucy is asleep, even if that event was missed.
  useEffect(() => {
    const unsubscribe = useAvatarState.subscribe((state, previous) => {
      if (!previous.isSleepMode && state.isSleepMode) {
        addWakeDebugEvent('info', 'Sleep state observed; shutting down audio/Gemini and starting wake listener.');
        isWakingUpRef.current = false;
        geminiRef.current?.disconnect();
        recorderRef.current?.stop();
        playerRef.current?.stopCurrentPlayback();
        playerRef.current?.stop();
        setListening(false);
        setSpeaking(false);
        setThinking(false);
        setIsMicOn(false);
        nativeWakeActiveRef.current = false;
        startWakeWordListenerRef.current();
      } else if (previous.isSleepMode && !state.isSleepMode) {
        nativeWakeActiveRef.current = false;
        void invoke('stop_native_wake_listener').catch(() => {});
      }
    });
    return unsubscribe;
  }, [addWakeDebugEvent, setListening, setSpeaking, setThinking, setIsMicOn]);

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

      let isSleepingTransition = false;
      const handleSleep = async () => {
        if (isSleepingTransition) return;
        isSleepingTransition = true;
        try {
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
          startWakeWordListenerRef.current();
          addWakeDebugEvent('info', 'Sleep transition complete; waiting for microphone and model telemetry.');
          logger.add('info', 'Sleep Mode', 'Entering low-RAM sleep mode... Say "Lucy" or "Hey Lucy" to wake me.');
          invoke('enter_sleep_mode').catch((error) => {
            setWakeDebug((current) => ({ ...current, detectorStatus: `Sleep command failed: ${String(error)}` }));
            addWakeDebugEvent('error', `Sleep command failed: ${String(error)}`);
          });
        } finally {
          isSleepingTransition = false;
        }
      };

      let lastWakeUpTime = 0;
      let wakeUpTimeout: ReturnType<typeof setTimeout> | null = null;
      const handleWakeUp = () => {
        const now = Date.now();
        if (now - lastWakeUpTime < 1000) {
          return;
        }
        lastWakeUpTime = now;

        setWakeDebug((current) => ({ ...current, detectorStatus: 'Wake event received; restoring the assistant…' }));
        addWakeDebugEvent('success', 'Wake event reached the main window.');
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
            initSystemRef.current(true, true);
            addWakeDebugEvent('info', 'Assistant core reinitialization requested.');
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
    }, [addWakeDebugEvent]);

  return { initialized, wakeDebug };
}
