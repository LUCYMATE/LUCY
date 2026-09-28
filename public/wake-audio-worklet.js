class NativePcmWakeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.offset = 0;
    this.queuedSamples = 0;
    this.port.onmessage = ({ data }) => {
      if (!Array.isArray(data) || !data.length) return;
      const chunk = Float32Array.from(data, value => Math.max(-1, Math.min(1, value / 32768)));
      this.chunks.push(chunk);
      this.queuedSamples += chunk.length;
      // Keep the bridge bounded if the recognizer stalls or restarts.
      while (this.queuedSamples > 48000 && this.chunks.length > 1) {
        const removed = this.chunks.shift();
        this.queuedSamples -= removed.length;
        this.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    let written = 0;
    while (written < output.length && this.chunks.length) {
      const chunk = this.chunks[0];
      const count = Math.min(output.length - written, chunk.length - this.offset);
      output.set(chunk.subarray(this.offset, this.offset + count), written);
      written += count;
      this.offset += count;
      this.queuedSamples -= count;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    if (written < output.length) output.fill(0, written);
    return true;
  }
}

registerProcessor('native-pcm-wake-bridge', NativePcmWakeProcessor);
