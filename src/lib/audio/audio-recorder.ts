import { logger } from '../store/logger';

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;

  public onData: ((data: Int16Array) => void) | null = null;

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  async start() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('navigator.mediaDevices API is not available. Are you in a secure context?');
      }
      
      logger.add('info', 'Mic Initialization', 'Requesting microphone access...');
      
      const timeoutPromise = (ms: number, msg: string) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms));

      const savedDeviceId = localStorage.getItem('soltini_mic_id');
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(savedDeviceId ? { deviceId: { exact: savedDeviceId } } : {})
      };

      this.stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: audioConstraints }),
        timeoutPromise(5000, 'getUserMedia timed out after 5 seconds')
      ]);
      
      logger.add('info', 'Mic Initialization', 'Got stream, setting up AudioContext...');
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      
      logger.add('info', 'Mic Initialization', 'Adding audio worklet module...');
      await Promise.race([
        this.audioContext.audioWorklet.addModule('/audio-worklet.js'),
        timeoutPromise(5000, 'audioWorklet.addModule timed out after 5 seconds')
      ]);
      
      logger.add('info', 'Mic Initialization', 'Connecting audio nodes...');
      
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-worklet');
      
      this.workletNode.port.onmessage = (event) => {
        if (this.onData) {
          this.onData(event.data);
        }
      };
      
      this.source.connect(this.analyser);
      this.source.connect(this.workletNode);
      // Removed this.workletNode.connect(this.audioContext.destination) to prevent loopback

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      logger.add('success', 'Mic Started', 'Microphone successfully connected and recording.');
    } catch (error) {
      logger.add('error', 'Mic Error', String(error));
      console.error('Error starting audio recorder:', error);
      throw error;
    }
  }

  stop() {
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
