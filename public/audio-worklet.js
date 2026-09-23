class AudioWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    // 1600 samples = 100ms at 16kHz (reduces chunk buffering latency from 256ms to 100ms)
    this.bufferSize = 1600;
    this.buffer = new Int16Array(this.bufferSize);
    this.bufferIndex = 0;
    this.sumSquares = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      
      for (let i = 0; i < channelData.length; i++) {
        let s = channelData[i];
        s = Math.max(-1, Math.min(1, s));
        this.sumSquares += s * s;
        this.buffer[this.bufferIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

        if (this.bufferIndex >= this.bufferSize) {
          const rms = Math.sqrt(this.sumSquares / this.bufferSize);
          this.port.postMessage({
            pcm: new Int16Array(this.buffer),
            rms: rms
          });
          this.bufferIndex = 0;
          this.sumSquares = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("audio-worklet", AudioWorklet);
