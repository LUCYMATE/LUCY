class AudioWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    // 2048 samples = 128ms at 16kHz (delivers audio 2x faster than 4096 for fast response times)
    this.bufferSize = 2048;
    this.buffer = new Int16Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      
      for (let i = 0; i < channelData.length; i++) {
        let s = channelData[i];
        s = Math.max(-1, Math.min(1, s));
        this.buffer[this.bufferIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

        if (this.bufferIndex >= this.bufferSize) {
          this.port.postMessage(new Int16Array(this.buffer));
          this.bufferIndex = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("audio-worklet", AudioWorklet);
