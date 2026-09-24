import { logger } from '../store/logger';

export interface WakeWordDetectorOptions {
  onWake: () => void;
  stream?: MediaStream;
}

/**
 * High-sensitivity on-device voice cadence wake detector for PC.
 * Analyzes audio chunks from AudioRecorder or standalone microphone stream
 * to instantly detect short spoken wake commands ("Wake up", "Lucy", "Wakeup", "Wake up Lucy", "Hey Lucy").
 */
export class WakeWordDetector {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private ownsStream = false;
  private isRunning = false;
  private onWake: () => void;

  private consecutiveSpeechFrames = 0;
  private silenceFrames = 0;
  private lastTriggerTimestamp = 0;
  private frameEnergies: number[] = [];

  constructor(options: WakeWordDetectorOptions) {
    this.onWake = options.onWake;
    if (options.stream) {
      this.stream = options.stream;
      this.ownsStream = false;
    }
  }

  public get active(): boolean {
    return this.isRunning;
  }

  /**
   * Process a 100ms PCM chunk with RMS value directly (e.g. from AudioRecorder worklet)
   */
  public processAudioChunk(_pcm: Int16Array, rms: number): void {
    if (!this.isRunning) return;

    const now = Date.now();
    if (now - this.lastTriggerTimestamp < 3000) {
      return; // 3-second cooldown to avoid duplicate triggers
    }

    // Voice detection threshold: normal spoken words start around ~0.010 - 0.015 RMS
    const SPEECH_THRESHOLD = 0.010;
    const isSpeech = rms >= SPEECH_THRESHOLD && rms < 0.95;

    if (isSpeech) {
      this.consecutiveSpeechFrames++;
      this.frameEnergies.push(rms);
      this.silenceFrames = 0;

      // If continuous noise persists longer than 2.2 seconds (e.g. background TV, loud music), reset
      if (this.consecutiveSpeechFrames > 22) {
        this.consecutiveSpeechFrames = 0;
        this.frameEnergies = [];
      }
    } else {
      if (this.consecutiveSpeechFrames > 0) {
        this.silenceFrames++;

        // Allow up to 2 frames (~200ms) of pause between syllables / words (e.g. "Wake" ... "up")
        if (this.silenceFrames >= 2) {
          // Natural spoken commands ("Lucy", "Wake up", "Wakeup", "Wake up Lucy", "Hey Lucy")
          // span between 2 and 16 frames (~200ms to 1600ms)
          if (this.consecutiveSpeechFrames >= 2 && this.consecutiveSpeechFrames <= 16) {
            const count = this.frameEnergies.length;
            let sum = 0;
            for (let i = 0; i < count; i++) {
              sum += this.frameEnergies[i];
            }
            const avg = sum / count;

            let varianceSum = 0;
            for (let i = 0; i < count; i++) {
              const diff = this.frameEnergies[i] - avg;
              varianceSum += diff * diff;
            }
            const stdDev = Math.sqrt(varianceSum / count);

            // Verify human vocal modulation (stdDev >= 0.002 or strong voice burst avg >= 0.020)
            if (stdDev >= 0.002 || avg >= 0.020) {
              this.lastTriggerTimestamp = now;
              this.consecutiveSpeechFrames = 0;
              this.silenceFrames = 0;
              this.frameEnergies = [];

              logger.add('success', 'Wake Word', `Voice command detected! (frames: ${count}, avg: ${avg.toFixed(3)}, stdDev: ${stdDev.toFixed(4)})`);
              this.onWake();
              return;
            }
          }

          // Reset on silence
          this.consecutiveSpeechFrames = 0;
          this.silenceFrames = 0;
          this.frameEnergies = [];
        }
      }
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.consecutiveSpeechFrames = 0;
    this.silenceFrames = 0;
    this.frameEnergies = [];

    // If an external stream was provided or processAudioChunk will be used directly,
    // we don't need a separate AudioContext pipeline unless standalone mode is requested
    if (!this.stream && !this.ownsStream) {
      try {
        const savedDeviceId = localStorage.getItem('lucy_mic_id');
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(savedDeviceId && savedDeviceId !== 'default' ? { deviceId: { exact: savedDeviceId } } : {}),
        };

        this.stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        this.ownsStream = true;

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.audioContext = new AudioCtx({ sampleRate: 16000 });
          if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume().catch(() => {});
          }

          try {
            await this.audioContext.audioWorklet.addModule('/audio-worklet.js');
            this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
            this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-worklet');

            this.workletNode.port.onmessage = (event) => {
              if (!this.isRunning) return;
              const rms = event.data?.rms || 0;
              const pcm = event.data?.pcm || new Int16Array(0);
              this.processAudioChunk(pcm, rms);
            };

            this.sourceNode.connect(this.workletNode);
            const silentGain = this.audioContext.createGain();
            silentGain.gain.value = 0;
            this.workletNode.connect(silentGain);
            silentGain.connect(this.audioContext.destination);
          } catch (workletErr) {
            console.warn('[WakeWordDetector] AudioWorklet setup fallback:', workletErr);
          }
        }
      } catch (err: any) {
        console.warn('[WakeWordDetector] Standalone mic stream error:', err);
      }
    }

    logger.add('info', 'Wake Word', 'Wake detector listening for "Lucy" / "Wake up"...');
  }

  public stop(): void {
    this.isRunning = false;
    this.consecutiveSpeechFrames = 0;
    this.silenceFrames = 0;
    this.frameEnergies = [];

    if (this.workletNode) {
      try {
        this.workletNode.disconnect();
      } catch (_) {}
      this.workletNode = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (_) {}
      this.sourceNode = null;
    }

    if (this.audioContext) {
      try {
        if (this.audioContext.state !== 'closed') {
          this.audioContext.close().catch(() => {});
        }
      } catch (_) {}
      this.audioContext = null;
    }

    if (this.ownsStream && this.stream) {
      try {
        this.stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      this.stream = null;
    }
  }
}
