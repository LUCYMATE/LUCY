import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** Adapts native 16 kHz PCM into a live MediaStreamTrack for Web Speech runtimes
 * that implement SpeechRecognition.start(audioTrack). */
export class NativeWakeBridge {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private unlisten: UnlistenFn | null = null;
  private started = false;

  async start(): Promise<MediaStreamTrack> {
    const deviceId = localStorage.getItem('lucy_mic_id') || 'default';
    const parsedBoost = Number.parseFloat(localStorage.getItem('lucy_mic_boost') || '2');
    const boost = Number.isFinite(parsedBoost) ? Math.max(1, Math.min(5, parsedBoost)) : 2;
    try {
      this.context = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      await this.context.audioWorklet.addModule('/wake-audio-worklet.js');
      this.node = new AudioWorkletNode(this.context, 'native-pcm-wake-bridge', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const destination = this.context.createMediaStreamDestination();
      this.node.connect(destination);
      const keepAlive = this.context.createGain();
      keepAlive.gain.value = 0;
      this.node.connect(keepAlive);
      keepAlive.connect(this.context.destination);
      this.stream = destination.stream;
      await this.context.resume();
      this.unlisten = await listen<number[]>('native-mic-frame', ({ payload }) => {
        this.node?.port.postMessage(payload);
      });
      await invoke('start_native_mic', { deviceId, boost });
      this.started = true;
      const track = this.stream.getAudioTracks()[0];
      if (!track || track.readyState !== 'live') throw new Error('Native audio bridge did not produce a live audio track.');
      return track;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    this.unlisten?.();
    this.unlisten = null;
    if (this.started) {
      this.started = false;
      await invoke('stop_native_mic').catch(() => {});
    }
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    try { this.node?.disconnect(); } catch {}
    this.node = null;
    if (this.context && this.context.state !== 'closed') await this.context.close().catch(() => {});
    this.context = null;
  }
}
