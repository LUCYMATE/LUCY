class AudioWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096; // 256ms at 16kHz
    this.buffer = new Int16Array(this.bufferSize);
    this.bufferIndex = 0;
    
    // Voice Activity Detection (VAD) properties
    // Lowered threshold from 0.015 to 0.003 to catch very quiet speech like "hello"
    this.threshold = 0.003; 
    this.framesSinceLastLoud = 100000; // Start assumed silent
    // Increased tail to 3.0 seconds to ensure Gemini's server VAD receives enough silence to trigger
    this.tailFrames = 16000 * 1.0; 
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      
      let isLoud = false;
      for (let i = 0; i < channelData.length; i++) {
        if (Math.abs(channelData[i]) > this.threshold) {
          isLoud = true;
          break;
        }
      }

      if (isLoud) {
        this.framesSinceLastLoud = 0;
      } else {
        this.framesSinceLastLoud += channelData.length;
      }

      // If we've heard loud noise recently, send the audio buffer
      if (this.framesSinceLastLoud < this.tailFrames) {
        for (let i = 0; i < channelData.length; i++) {
          let s = Math.max(-1, Math.min(1, channelData[i]));
          this.buffer[this.bufferIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;

          if (this.bufferIndex >= this.bufferSize) {
            this.port.postMessage(new Int16Array(this.buffer));
            this.bufferIndex = 0;
          }
        }
      } else {
        // Silence limit reached, drop frames to save tokens and reset buffer
        this.bufferIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor("audio-worklet", AudioWorklet);
