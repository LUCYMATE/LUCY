import { logger } from '../store/logger';

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;

  private heartbeatInterval: any = null;
  private lastDataTime: number = 0;
  public onMicFrozen?: () => void;
  public onData: ((data: Int16Array) => void) | null = null;

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  async start() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('navigator.mediaDevices API is not available. Are you in a secure context?');
      }
      
      const timeoutPromise = (ms: number, msg: string) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms));

      const savedDeviceId = localStorage.getItem('soltini_mic_id');
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        ...(savedDeviceId && savedDeviceId !== 'default' ? { deviceId: { exact: savedDeviceId } } : {})
      };

      try {
        this.stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({ audio: audioConstraints }),
          timeoutPromise(5000, 'getUserMedia timed out after 5 seconds')
        ]);
      } catch (err) {
        if (audioConstraints.deviceId) {
          logger.add('info', 'Mic Initialization', 'Failed with exact deviceId. Falling back to default microphone.');
          this.stream = await Promise.race([
            navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } }),
            timeoutPromise(5000, 'getUserMedia timed out after 5 seconds')
          ]);
        } else {
          throw err;
        }
      }
      
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      
      await Promise.race([
        this.audioContext.audioWorklet.addModule('/audio-worklet.js'),
        timeoutPromise(5000, 'audioWorklet.addModule timed out after 5 seconds')
      ]);
      
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-worklet');
      
      this.workletNode.port.onmessage = (event) => {
        this.lastDataTime = Date.now();
        if (this.onData) {
          this.onData(event.data);
        }
      };
      
      this.source.connect(this.analyser);
      this.source.connect(this.workletNode);
      
      // Prevent browser/WebView from suspending AudioContext after idle time
      const keepAliveGain = this.audioContext.createGain();
      keepAliveGain.gain.value = 0;
      this.workletNode.connect(keepAliveGain);
      keepAliveGain.connect(this.audioContext.destination);

      this.lastDataTime = Date.now();
      
      this.heartbeatInterval = setInterval(() => {
        // 1. Play a 1ms silent blip to keep the context awake
        if (this.audioContext && this.audioContext.state !== 'closed') {
          try {
            const osc = this.audioContext.createOscillator();
            osc.connect(keepAliveGain);
            osc.start();
            osc.stop(this.audioContext.currentTime + 0.001); // 1ms beep
          } catch (e) {}
        }

        // 2. Check if the worklet stopped sending data (device slept or suspended)
        if (Date.now() - this.lastDataTime > 15000) {
          // No data received for 15 seconds! The mic is frozen.
          if (this.onMicFrozen) this.onMicFrozen();
        }
      }, 10000); // Check every 10 seconds

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
    } catch (error) {
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
