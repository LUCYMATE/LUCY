import { logger } from '../store/logger';

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;

  private micPreamp: GainNode | null = null;
  private heartbeatInterval: any = null;
  private lastDataTime: number = 0;
  public onData: ((data: Int16Array) => void) | null = null;
  public onMicFrozen: (() => void) | null = null;

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  setMicBoost(boost: number) {
    if (this.micPreamp) {
      this.micPreamp.gain.value = Math.max(1.0, Math.min(5.0, boost));
    }
  }

  async start() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('navigator.mediaDevices API is not available. Are you in a secure context?');
      }
      
      const getUserMediaWithTimeout = (constraints: MediaStreamConstraints, ms: number) =>
        new Promise<MediaStream>((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            settled = true;
            reject(new Error(`getUserMedia timed out after ${ms} ms`));
          }, ms);
          navigator.mediaDevices.getUserMedia(constraints).then(stream => {
            if (settled) {
              stream.getTracks().forEach(track => track.stop());
              return;
            }
            clearTimeout(timer);
            resolve(stream);
          }, error => {
            if (settled) return;
            clearTimeout(timer);
            reject(error);
          });
        });

      const savedDeviceId = localStorage.getItem('lucy_mic_id');
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        ...(savedDeviceId && savedDeviceId !== 'default' ? { deviceId: { exact: savedDeviceId } } : {})
      };

      try {
        this.stream = await getUserMediaWithTimeout({ audio: audioConstraints }, 5000);
      } catch (err) {
        if (audioConstraints.deviceId) {
          logger.add('info', 'Mic Initialization', 'Failed with exact deviceId. Falling back to default microphone.');
          this.stream = await getUserMediaWithTimeout({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }, 5000);
        } else {
          throw err;
        }
      }
      
      this.audioContext = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      
        await this.audioContext.audioWorklet.addModule('/audio-worklet.js');
      
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-worklet');

      // Digital pre-amp gain boost for soft / low voices (default 2.0x / +6dB)
      const savedBoost = parseFloat(localStorage.getItem('lucy_mic_boost') || '2.0');
      const boostFactor = isNaN(savedBoost) ? 2.0 : Math.max(1.0, Math.min(5.0, savedBoost));
      this.micPreamp = this.audioContext.createGain();
      this.micPreamp.gain.value = boostFactor;
      
      this.workletNode.port.onmessage = (event) => {
        if (this.onData) {
          this.onData(event.data);
        }
      };
      
      this.source.connect(this.micPreamp);
      this.micPreamp.connect(this.analyser);
      this.micPreamp.connect(this.workletNode);
      
      // Prevent browser/WebView from suspending AudioContext after idle time
      const keepAliveGain = this.audioContext.createGain();
      keepAliveGain.gain.value = 0;
      this.workletNode.connect(keepAliveGain);
      keepAliveGain.connect(this.audioContext.destination);

      this.lastDataTime = Date.now();
      
      this.heartbeatInterval = setInterval(() => {
        // Play a 1ms silent blip to keep the AudioContext awake on Chromium/Tauri WebViews
        if (this.audioContext && this.audioContext.state !== 'closed') {
          try {
            const osc = this.audioContext.createOscillator();
            osc.connect(keepAliveGain);
            osc.start();
            osc.stop(this.audioContext.currentTime + 0.001); // 1ms beep
          } catch (e) {}
        }
      }, 10000); // Check every 10 seconds

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
    } catch (error) {
      this.stop();
      logger.add('error', 'Mic Error', String(error));
      console.error('Error starting audio recorder:', error);
      throw error;
    }
  }

  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch (e) {}
      this.workletNode = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch (e) {}
      this.source = null;
    }
    if (this.micPreamp) {
      try { this.micPreamp.disconnect(); } catch (e) {}
      this.micPreamp = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch (e) {}
      this.analyser = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        track.enabled = false;
        track.stop();
      });
      this.stream = null;
    }
    if (this.audioContext) {
      try { this.audioContext.close(); } catch (e) {}
      this.audioContext = null;
    }
  }
}
