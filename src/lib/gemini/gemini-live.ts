import { logger } from '../store/logger';
import { GoogleGenAI, Modality } from '@google/genai';
import { invoke } from '@tauri-apps/api/core';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export class GeminiLive {
  private session: any = null;
  private setupComplete = false;
  private _state: ConnectionState = 'idle';

  // --- Callbacks ---
  public onStateChange: ((state: ConnectionState, detail?: string) => void) | null = null;
  public onAudio:       ((pcmBase64: string) => void) | null = null;
  public onTranscript:  ((text: string, isInput: boolean) => void) | null = null;
  public onThinking:    ((thinking: boolean) => void) | null = null;
  public onInterrupted: (() => void) | null = null;

  private setState(state: ConnectionState, detail?: string) {
    this._state = state;
    this.onStateChange?.(state, detail);
  }

  async connect(apiKey: string) {
    if (this.session) {
      this.disconnect();
    }

    this.setupComplete = false;
    this.setState('connecting');

    try {
      const ai = new GoogleGenAI({ apiKey });
      
      const savedModel = localStorage.getItem('myra_model') || 'gemini-3.1-flash-live-preview';
      const savedVoice = localStorage.getItem('myra_voice') || 'Aoede';
      const coreInstruction = `You are Myra, an advanced OS-level voice assistant.
CRITICAL BEHAVIORS:
1. VOICE FIRST: Keep your spoken replies extremely concise, conversational, and natural.
2. TRUE HUMAN AUTOMATION: 
   - Use 'open_external_url' to open websites first.
   - If a site is open, use 'capture_screen' to look at it. The screenshot has a 100px grid (Red vertical, Blue horizontal). Count the grid lines to calculate precise X and Y coordinates, then use 'move_and_click_mouse'.
   - For YouTube: Press '/' using 'press_key' to focus the search bar, 'type_string' your query, and press 'Enter'.
   - SCROLL: Use 'scroll_mouse' (e.g. -20 for down, 20 for up).
3. PROACTIVE EXECUTION: Never ask for permission to use tools. Never narrate what tools you are using. Just do it.
4. CONTEXT AWARENESS: Never blindly repeat previous tool actions. Listen to the user's current request.`;

      const userPersonality = localStorage.getItem('myra_system_instruction') || '';
      const finalInstruction = userPersonality.trim() 
        ? `${coreInstruction}\n\nUSER PERSONALITY PREFERENCES:\n${userPersonality}` 
        : coreInstruction;

      logger.add('info', 'Connecting', `Model: ${savedModel}, Voice: ${savedVoice}`);
      
      const session = await ai.live.connect({
        model: savedModel,
        callbacks: {
          onopen: () => {
            logger.add('success', 'Setup Complete', 'Gemini Live system is fully connected and ready for input.');
            console.log('[GeminiLive] Setup complete -> CONNECTED');
            this.setupComplete = true;
            this.setState('connected');
          },
          onmessage: async (message: any) => {
            try {
              const serverContent = message?.serverContent ?? message?.server_content;
              
              if (serverContent?.interrupted) {
                logger.add('warning', 'Interrupted', 'User interrupted the model.');
                this.onInterrupted?.();
              }

              const toolCall = message?.toolCall ?? message?.tool_call;
              if (toolCall) {
                const functionCalls = toolCall.functionCalls ?? toolCall.function_calls ?? [];
                const functionResponses: any[] = [];
                
                for (const fc of functionCalls) {
                  const { name, id, args } = fc;
                  logger.add('info', `Tool Call Received: ${name}`, JSON.stringify(args));
                  
                  let result: any = null;
                  try {
                    if (name === 'get_system_stats') {
                      result = await invoke('get_system_stats');
                    } else if (name === 'open_external_url') {
                      await invoke('open_external_url', { url: args.url });
                      result = { success: true };
                    } else if (name === 'move_and_click_mouse') {
                      const x = parseInt(args.x as string, 10) || 0;
                      const y = parseInt(args.y as string, 10) || 0;
                      await invoke('move_and_click_mouse', { x, y });
                      result = { success: true };
                    } else if (name === 'scroll_mouse') {
                      const amount = parseInt(args.amount as string, 10) || -20;
                      await invoke('scroll_mouse', { amount });
                      result = { success: true };
                    } else if (name === 'type_string') {
                      await invoke('type_string', { text: args.text });
                      result = { success: true };
                    } else if (name === 'run_python_script') {
                      const output = await invoke('run_python_script', { script: args.script });
                      result = { success: true, output };
                    } else if (name === 'run_terminal_command') {
                      const output = await invoke('run_terminal_command', { command: args.command });
                      result = { success: true, output };
                    } else if (name === 'press_key') {
                      await invoke('press_key', { key: args.key });
                      result = { success: true };
                    } else if (name === 'capture_screen') {
                      const screenData = await invoke<{base64: string, width: number, height: number}>('capture_screen');
                      
                      try {
                        this.session.sendRealtimeInput([{
                          mimeType: "image/jpeg",
                          data: screenData.base64
                        }]);
                        result = { success: true, message: `Screenshot captured. SCREEN RESOLUTION is Width: ${screenData.width}px, Height: ${screenData.height}px. Use these dimensions to accurately calculate the X, Y coordinates for move_and_click_mouse.` };
                      } catch (e) {
                        result = { error: 'Failed to inject screenshot: ' + String(e) };
                      }
                    } else if (name === 'capture_camera') {
                      try {
                        const savedCameraId = localStorage.getItem('myra_camera_id');
                        const videoConstraints = savedCameraId ? { deviceId: { exact: savedCameraId } } : true;
                        const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
                        const video = document.createElement('video');
                        video.srcObject = stream;
                        await video.play();
                        
                        // Wait a tiny bit for the camera to auto-expose
                        await new Promise(r => setTimeout(r, 500));
                        
                        const canvas = document.createElement('canvas');
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                        const ctx = canvas.getContext('2d');
                        ctx?.drawImage(video, 0, 0);
                        
                        const base64Jpeg = canvas.toDataURL('image/jpeg').split(',')[1];
                        stream.getTracks().forEach(track => track.stop());

                        this.session.sendRealtimeInput([{
                          mimeType: "image/jpeg",
                          data: base64Jpeg
                        }]);
                        result = { success: true, message: 'Webcam photo captured and injected into your visual cortex. Look at the image.' };
                      } catch (e) {
                        result = { error: 'Failed to capture webcam: ' + String(e) };
                      }
                    } else {
                      result = { error: `Function ${name} not found` };
                    }
                  } catch (err) {
                    result = { error: `Failed to execute ${name}: ${String(err)}` };
                    logger.add('error', `Tool Call Failed: ${name}`, String(err));
                  }
                  
                  logger.add('success', `Tool Executed: ${name}`, JSON.stringify(result));
                  functionResponses.push({
                    name,
                    id,
                    response: { output: result }
                  });
                }
              
                if (functionResponses.length > 0) {
                  if (typeof this.session.sendToolResponse === 'function') {
                    this.session.sendToolResponse({ functionResponses });
                  } else {
                    this.session.send({ toolResponse: { functionResponses } });
                  }
                }
              }

              const modelTurn = serverContent?.modelTurn ?? serverContent?.model_turn;
              const parts = modelTurn?.parts ?? [];
              
              if (parts.length > 0) {
                 this.onThinking?.(false);
              }

              for (const part of parts) {
                const inlineData = part?.inlineData ?? part?.inline_data;
                if (inlineData?.data) {
                  this.onAudio?.(inlineData.data);
                }

                if (part?.text) {
                  this.onTranscript?.(part.text, false);
                }
              }

              const outputTranscription = serverContent?.outputTranscription ?? serverContent?.output_transcription;
              const outputText = outputTranscription?.text;
              if (outputText) {
                this.onTranscript?.(outputText, false);
              }

              const inputTranscription = serverContent?.inputTranscription ?? serverContent?.input_transcription;
              const inputText = inputTranscription?.text;
              if (inputText) {
                this.onTranscript?.(inputText, true);
              }

              if (serverContent?.turnComplete || serverContent?.turn_complete) {
                logger.add('info', 'Turn Complete', 'Model finished generating its response.');
                console.log('[GeminiLive] turnComplete');
              }
            } catch (err) {
              logger.add('error', 'Message Parse Error', String(err));
              console.error('[GeminiLive] parse error:', err);
            }
          },
          onerror: (event: any) => {
            const msg = event?.message || 'WebSocket error';
            logger.add('error', 'WebSocket Error', msg);
            console.error('[GeminiLive] WS error:', event);
            this.setState('error', msg);
          },
          onclose: (event: any) => {
            const reason = event?.reason || 'none';
            const code = event?.code || 0;
            logger.add('warning', 'WebSocket Closed', `Code: ${code}, Reason: ${reason}`);
            console.log(`[GeminiLive] WS closed ${code} — ${reason}`);
            this.setupComplete = false;
            this.setState('disconnected', reason || `code ${code}`);
            this.session = null;
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: savedVoice,
              },
            },
          },
          systemInstruction: finalInstruction,
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'get_system_stats',
                  description: 'Read the current system resource statistics, including CPU usage percentage, total memory, and used memory.',
                  parameters: { type: 'OBJECT', properties: {} }
                },
                {
                  name: 'open_external_url',
                  description: 'Open a URL or website in the default browser.',
                  parameters: {
                    type: 'OBJECT',
                    properties: { url: { type: 'STRING', description: 'The absolute URL' } },
                    required: ['url']
                  }
                },
                {
                  name: 'move_and_click_mouse',
                  description: 'Move the mouse to X, Y coordinates and click.',
                  parameters: {
                    type: 'OBJECT',
                    properties: { x: { type: 'INTEGER' }, y: { type: 'INTEGER' } },
                    required: ['x', 'y']
                  }
                },
                {
                  name: 'scroll_mouse',
                  description: 'Scroll the mouse. Use LARGE numbers. Negative=down (e.g. -20), positive=up (e.g. 20).',
                  parameters: {
                    type: 'OBJECT',
                    properties: { amount: { type: 'INTEGER' } },
                    required: ['amount']
                  }
                },
                {
                  name: 'type_string',
                  description: 'Type a string of text on the keyboard.',
                  parameters: {
                    type: 'OBJECT',
                    properties: { text: { type: 'STRING' } },
                    required: ['text']
                  }
                },
                {
                  name: 'run_python_script',
                  description: 'Write and execute a Python script.',
                  parameters: {
                    type: 'OBJECT',
                    properties: { script: { type: 'STRING' } },
                    required: ['script']
                  }
                },
                {
                  name: 'run_terminal_command',
                  description: 'Execute a command in the terminal. Do NOT use this to open websites.',
                  parameters: {
                    type: 'OBJECT',
                    properties: { command: { type: 'STRING' } },
                    required: ['command']
                  }
                },
                {
                  name: 'press_key',
                  description: 'Simulate a keypress (e.g., enter, tab, space, /, escape, shift).',
                  parameters: {
                    type: 'OBJECT',
                    properties: { key: { type: 'STRING' } },
                    required: ['key']
                  }
                },
                {
                  name: 'capture_screen',
                  description: 'Take a screenshot of primary display.',
                  parameters: { type: 'OBJECT', properties: {} }
                },
                {
                  name: 'capture_camera',
                  description: 'Take a photo using the user\'s webcam to see them or their physical environment.',
                  parameters: { type: 'OBJECT', properties: {} }
                }
              ]
            }
          ]
        },
      } as any);

      this.session = session;
    } catch (err) {
      logger.add('error', 'Connection Error', String(err));
      console.error('[GeminiLive] connect error:', err);
      this.setState('error', err instanceof Error ? err.message : String(err));
    }
  }

  // ---------------------------------------------------------------
  // Send text
  sendText(text: string) {
    if (!this.isReady()) {
      logger.add('warning', 'Send Text Failed', 'Cannot send text because the connection is not ready.');
      console.warn('[GeminiLive] sendText — not ready');
      return;
    }
    this.onThinking?.(true);
    logger.add('info', 'Sending Text', text);
    
    try {
      if (typeof this.session.sendClientContent === 'function') {
        this.session.sendClientContent({
          turns: [{
            role: 'user',
            parts: [{ text }]
          }],
          turnComplete: true
        });
      } else {
        this.session.send({ parts: [{ text }] });
      }
    } catch (err) {
      try {
        this.session.send(text);
      } catch (e2) {
        if (this.session.sendRealtimeInput) {
           this.session.sendRealtimeInput({ text });
        } else {
           console.error('[GeminiLive] Could not send text', e2);
        }
      }
    }
  }

  // ---------------------------------------------------------------
  // Send raw 16kHz PCM16 audio chunk
  private audioChunksSent = 0;

  sendAudio(pcm16: Int16Array) {
    if (!this.isReady()) return;
    const base64 = this._toBase64(new Uint8Array(pcm16.buffer));
    
    if (this.audioChunksSent === 0) {
      logger.add('info', 'Audio Stream', `Started sending audio chunks to server (first chunk size: ${pcm16.length})`);
    }
    this.audioChunksSent++;

    this.session.sendRealtimeInput({
      audio: {
        mimeType: 'audio/pcm;rate=16000',
        data: base64,
      }
    });
  }

  // ---------------------------------------------------------------
  disconnect() {
    this.setupComplete = false;
    if (this.session) {
      this.session.close?.();
      this.session = null;
    }
    this.setState('disconnected');
  }

  isReady() {
    return this.setupComplete && this.session != null;
  }

  // ---------------------------------------------------------------
  private _toBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
  }
}
