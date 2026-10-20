import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { logger } from '../store/logger';

// Global serialized operation lock across all AudioRecorder instances.
// Guarantees start_native_mic and stop_native_mic can NEVER race or execute out-of-order.
let globalMicOperation: Promise<any> = Promise.resolve();

function enqueueMicOp<T>(op: () => Promise<T>): Promise<T> {
  const next = globalMicOperation.then(op, op);
  globalMicOperation = next.catch(() => {});
  return next;
}

/** Native microphone capture. Frames keep the established 16 kHz mono PCM16
 * contract consumed by GeminiLive, while the Rust side owns the device. */
export class AudioRecorder {
  private unlistenFrame: UnlistenFn | null = null;
  private unlistenError: UnlistenFn | null = null;
  private unlistenWarning: UnlistenFn | null = null;
  private isCapturing = false;
  private boost = 2;
  public onData: ((data: Int16Array) => void) | null = null;
  public onMicFrozen: (() => void) | null = null;

  getAnalyser(): AnalyserNode | null {
    return null;
  }

  isActive(): boolean {
    return this.isCapturing;
  }

  setMicBoost(boost: number) {
    this.boost = Math.max(1, Math.min(5, boost));
    void invoke('set_native_mic_boost', { boost: this.boost }).catch((error) => {
      logger.add('warning', 'Microphone', `Could not update microphone gain: ${String(error)}`);
    });
  }

  async start(): Promise<void> {
    return enqueueMicOp(async () => {
      if (this.isCapturing) return;

      this.unlistenFrame?.();
      this.unlistenError?.();
      this.unlistenWarning?.();
      this.unlistenFrame = null;
      this.unlistenError = null;
      this.unlistenWarning = null;

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
        this.isCapturing = true;
      } catch (error) {
        this.unlistenFrame?.();
        this.unlistenError?.();
        this.unlistenWarning?.();
        this.unlistenFrame = null;
        this.unlistenError = null;
        this.unlistenWarning = null;
        this.isCapturing = false;
        throw error;
      }
    });
  }

  stop(): Promise<void> {
    return this.stopAndWait();
  }

  async stopAndWait(): Promise<void> {
    return enqueueMicOp(async () => {
      this.unlistenFrame?.();
      this.unlistenError?.();
      this.unlistenWarning?.();
      this.unlistenFrame = null;
      this.unlistenError = null;
      this.unlistenWarning = null;
      this.isCapturing = false;

      try {
        await invoke('stop_native_mic');
      } catch (error) {
        logger.add('warning', 'Microphone', `Could not stop microphone capture cleanly: ${String(error)}`);
      }
    });
  }
}
