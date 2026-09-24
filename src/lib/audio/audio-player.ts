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

  start() {
    this.audioContext = new AudioContext({ sampleRate: 24000 }); // 24kHz — Gemini output rate
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    
    this.gainNode = this.audioContext.createGain();
    this.muted = localStorage.getItem('lucy_muted') === 'true';
    this.gainNode.gain.value = this.muted ? 0 : 1;

    // Connect: source -> gainNode -> analyser -> destination
    this.gainNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
    
    this.nextPlayTime = this.audioContext.currentTime;

    // VERY IMPORTANT: Browsers block AudioContext playback until the user interacts with the page.
    // If the Tauri backend wasn't fully restarted, the autoplay flag might not apply.
    // We attach a one-time global listener to resume the context on the very first click/touch.
    if (!this.hasAttachedGesture && typeof window !== 'undefined') {
      this.hasAttachedGesture = true;
      const resumeAudio = () => {
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
        // Once resumed, we don't need these listeners anymore
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

  playChunk(pcmBase64: string): number {
    if (!this.audioContext || !this.gainNode) return 0;

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(err => console.warn('Failed to resume AudioContext:', err));
    }

    // Decode base64 → binary bytes
    const binary = atob(pcmBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Convert 16-bit PCM (little-endian Int16) → Float32
    const int16 = new Int16Array(bytes.buffer);
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
    if (this.nextPlayTime < now + 0.05) {
      this.nextPlayTime = now + 0.05;
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
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
    this.gainNode = null;
    this.nextPlayTime = 0;
  }
}
