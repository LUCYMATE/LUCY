// Audio output from Gemini Live is 24kHz, 16-bit PCM, little-endian
// Per docs: "Audio output always uses a sample rate of 24kHz"
export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private nextPlayTime = 0;

  start() {
    this.audioContext = new AudioContext({ sampleRate: 24000 }); // 24kHz — Gemini output rate
    this.nextPlayTime = this.audioContext.currentTime;
  }

  playChunk(pcmBase64: string): number {
    if (!this.audioContext) return 0;

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
    source.connect(this.audioContext.destination);

    const now = this.audioContext.currentTime;
    if (this.nextPlayTime < now + 0.05) {
      this.nextPlayTime = now + 0.05;
    }
    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;

    return buffer.duration;
  }

  stop() {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.nextPlayTime = 0;
  }
}
