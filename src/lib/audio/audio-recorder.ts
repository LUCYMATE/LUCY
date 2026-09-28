import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from '../store/logger';

/** Native microphone capture. Frames keep the established 16 kHz mono PCM16
 * contract consumed by GeminiLive, while the Rust side owns the device. */
export class AudioRecorder {
  private unlistenFrame: UnlistenFn | null = null;
  private unlistenError: UnlistenFn | null = null;
  private unlistenWarning: UnlistenFn | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> = Promise.resolve();
  private boost = 2;
  public onData: ((data: Int16Array) => void) | null = null;
  public onMicFrozen: (() => void) | null = null;

  getAnalyser(): AnalyserNode | null {
    // Native capture has no WebAudio graph. The current UI does not consume this analyser.
    return null;
  }

  setMicBoost(boost: number) {
    this.boost = Math.max(1, Math.min(5, boost));
    void invoke('set_native_mic_boost', { boost: this.boost }).catch((error) => {
      logger.add('warning', 'Microphone', `Could not update microphone gain: ${String(error)}`);
    });
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startNative();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startNative() {
    await this.stopPromise;
    const savedDeviceId = localStorage.getItem('lucy_mic_id') || 'default';
    const savedBoost = Number.parseFloat(localStorage.getItem('lucy_mic_boost') || '2');
    this.boost = Number.isFinite(savedBoost) ? Math.max(1, Math.min(5, savedBoost)) : 2;

    this.unlistenFrame = await listen<number[]>('native-mic-frame', ({ payload }) => {
      if (this.onData && payload.length) this.onData(Int16Array.from(payload));
    });
    this.unlistenError = await listen<string>('native-mic-error', ({ payload }) => {
      logger.add('error', 'Microphone', payload);
      this.onMicFrozen?.();
    });
    this.unlistenWarning = await listen<string>('native-mic-warning', ({ payload }) => {
      logger.add('warning', 'Microphone', payload);
    });

    try {
      await invoke('start_native_mic', { deviceId: savedDeviceId, boost: this.boost });
    } catch (error) {
      this.unlistenFrame?.();
      this.unlistenError?.();
      this.unlistenWarning?.();
      this.unlistenFrame = null;
      this.unlistenError = null;
      this.unlistenWarning = null;
      throw error;
    }
  }

  stop() {
    void this.stopAndWait();
  }

  async stopAndWait() {
    this.unlistenFrame?.();
    this.unlistenError?.();
    this.unlistenWarning?.();
    this.unlistenFrame = null;
    this.unlistenError = null;
    this.unlistenWarning = null;
    this.stopPromise = invoke<void>('stop_native_mic').catch((error) => {
      logger.add('warning', 'Microphone', `Could not stop microphone capture cleanly: ${String(error)}`);
    });
    await this.stopPromise;
  }
}
