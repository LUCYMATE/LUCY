let activeAudioPlayer: AudioPlayer | null = null;
export function getActiveAudioPlayer(): AudioPlayer | null {
  return activeAudioPlayer;
}

// Audio output from Gemini Live is 24kHz, 16-bit PCM, little-endian
// Per docs: "Audio output always uses a sample rate of 24kHz"
export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private nextPlayTime = 0;
  private muted = false;
  private activeSources: AudioBufferSourceNode[] = [];
  private hasAttachedGesture = false;
  private freqData: Uint8Array | null = null;

  start() {
    activeAudioPlayer = this;
    this.audioContext = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.4;
    
    this.gainNode = this.audioContext.createGain();
    this.muted = localStorage.getItem('lucy_muted') === 'true';
    this.gainNode.gain.value = this.muted ? 0 : 1;

    // Connect: source -> gainNode -> analyser -> destination
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
    
    this.nextPlayTime = this.audioContext.currentTime;

    if (!this.hasAttachedGesture && typeof window !== 'undefined') {
      this.hasAttachedGesture = true;
      const resumeAudio = () => {
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
        window.removeEventListener('pointerdown', resumeAudio);
        window.removeEventListener('keydown', resumeAudio);
      };
      window.addEventListener('pointerdown', resumeAudio, { once: true });
      window.addEventListener('keydown', resumeAudio, { once: true });
    }
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Returns normalized real-time vocal volume (0.0 to 1.0) derived from Web Audio FFT
   */
  getSpeechVolume(): number {
    if (!this.analyser || !this.isPlaying() || this.muted) return 0;
    if (!this.freqData || this.freqData.length !== this.analyser.frequencyBinCount) {
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    }
    this.analyser.getByteFrequencyData(this.freqData);

    // Vocal formant frequency band (approx 200Hz to 3200Hz)
    let sum = 0;
    const startBin = 2;
    const endBin = Math.min(32, this.freqData.length);
    for (let i = startBin; i < endBin; i++) {
      sum += this.freqData[i];
    }
    const avg = sum / (endBin - startBin);
    return Math.min(1.0, Math.max(0, (avg / 120.0)));
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    localStorage.setItem('lucy_muted', String(muted));
    if (this.gainNode) {
      this.gainNode.gain.value = muted ? 0 : 1;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  getRemainingTime(): number {
    if (!this.audioContext) return 0;
    const now = this.audioContext.currentTime;
    return Math.max(0, this.nextPlayTime - now);
  }

  isPlaying(): boolean {
    if (!this.audioContext) return false;
    const now = this.audioContext.currentTime;
    return (this.nextPlayTime - now) > 0.02 || this.activeSources.length > 0;
  }

  playChunk(pcmBase64: string): number {
    if (!this.audioContext || !this.gainNode) return 0;

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(err => console.warn('Failed to resume AudioContext:', err));
    }

    // Decode base64 → binary bytes
    const binary = atob(pcmBase64);
    // Align to even byte length for 16-bit PCM chunks (prevents RangeError on odd byte chunks)
    const byteLen = binary.length - (binary.length % 2);
    if (byteLen === 0) return 0;

    const bufferArray = new ArrayBuffer(byteLen);
    const bytes = new Uint8Array(bufferArray);
    for (let i = 0; i < byteLen; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Convert 16-bit PCM (little-endian Int16) → Float32
    const int16 = new Int16Array(bufferArray);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    if (float32.length === 0) return 0;

    // Schedule playback
    const buffer = this.audioContext.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    const now = this.audioContext.currentTime;
    if (this.nextPlayTime < now + 0.015) {
      this.nextPlayTime = now + 0.015;
    }
    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;

    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter(s => s !== source);
    };

    return buffer.duration;
  }

  stopCurrentPlayback() {
    if (this.audioContext) {
      this.activeSources.forEach(source => {
        try {
          source.stop();
        } catch (e) {
          // Ignore if already stopped
        }
      });
      this.activeSources = [];
      this.nextPlayTime = this.audioContext.currentTime;
    }
  }

  stop() {
    this.stopCurrentPlayback();
    if (activeAudioPlayer === this) {
      activeAudioPlayer = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
    this.gainNode = null;
    this.nextPlayTime = 0;
  }
}
