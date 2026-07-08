import { logger } from '../store/logger';
import { memoryStore } from '../memory/memory-store';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import { invoke } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';
import { BOT_NAME, VALID_POSES } from '../../config/bot-profile';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

// ─── Shared Local Tool Executor ──────────────────────────────────────────────────
async function executeTool(name: string, args: any, deferredMedia?: string[]): Promise<any> {
  let result: any = null;
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
      const resizedBase64 = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          let targetWidth = img.width;
          let targetHeight = img.height;
          const maxDim = 1024;
          if (targetWidth > maxDim || targetHeight > maxDim) {
            const ratio = Math.min(maxDim / targetWidth, maxDim / targetHeight);
            targetWidth = Math.floor(targetWidth * ratio);
            targetHeight = Math.floor(targetHeight * ratio);
          }
          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, targetWidth, targetHeight);
          resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
        };
        img.onerror = reject;
        img.src = 'data:image/jpeg;base64,' + screenData.base64;
      });
      if (deferredMedia) {
        deferredMedia.push(resizedBase64);
      }
      result = { success: true, message: `Screenshot captured. SCREEN RESOLUTION is Width: ${screenData.width}px, Height: ${screenData.height}px. Use these dimensions to accurately calculate the X, Y coordinates for move_and_click_mouse.` };
    } catch (e) {
      result = { error: 'Failed to inject screenshot: ' + String(e) };
    }
  } else if (name === 'capture_camera') {
    try {
      const savedCameraId = localStorage.getItem('soltini_camera_id');
      const videoConstraints = savedCameraId ? { deviceId: { exact: savedCameraId } } : true;
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      await new Promise(r => setTimeout(r, 500));
      let targetWidth = video.videoWidth;
      let targetHeight = video.videoHeight;
      const maxDim = 1024;
      if (targetWidth > maxDim || targetHeight > maxDim) {
        const ratio = Math.min(maxDim / targetWidth, maxDim / targetHeight);
        targetWidth = Math.floor(targetWidth * ratio);
        targetHeight = Math.floor(targetHeight * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0, targetWidth, targetHeight);
      const base64Jpeg = canvas.toDataURL('image/jpeg').split(',')[1];
      stream.getTracks().forEach(track => track.stop());
      if (deferredMedia) {
        deferredMedia.push(base64Jpeg);
      }
      result = { success: true, message: 'Webcam photo captured and injected into your visual cortex. Look at the image.' };
    } catch (e) {
      result = { error: 'Failed to capture webcam: ' + String(e) };
    }
  } else if (name === 'search_web') {
    try {
      const query = args.query || '';
      const tavilyKey = localStorage.getItem('soltini_tavily_api_key') || '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';
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: query,
          max_results: 3
        })
      });
      const json = await response.json();
      const snippets = json.results?.map((r: any) => `${r.title}: ${r.content}`).slice(0, 3) || [];
      result = { success: true, data: snippets };
    } catch (e) {
      result = { error: 'Search failed: ' + String(e) };
    }
  } else if (name === 'remember_fact') {
    const key = String(args.key || '');
    const value = String(args.value || '');
    if (key && value) {
      memoryStore.setUserFact(key, value);
      result = { success: true, message: `Remembered: ${key} = ${value}` };
    } else {
      result = { error: 'Both key and value are required' };
    }
  } else if (name === 'forget_fact') {
    const key = String(args.key || '');
    if (key) {
      memoryStore.deleteUserFact(key);
      result = { success: true, message: `Forgot: ${key}` };
    } else {
      result = { error: 'key is required' };
    }
  } else if (name === 'set_pet_name') {
    const petName2 = String(args.name || '').trim();
    if (petName2) {
      localStorage.setItem('soltini_pet_name', petName2);
      result = { success: true, petName: petName2 };
    } else {
      result = { error: 'name is required' };
    }
  } else if (name === 'open_app') {
    try {
      const appName = String(args.app_name || '').trim();
      const output = await invoke('run_terminal_command', { command: `start ${appName}` });
      result = { success: true, output };
    } catch (e) {
      result = { error: 'Failed to open app: ' + String(e) };
    }
  } else if (name === 'set_pose') {
    try {
      const { useAvatarState } = await import('../store/avatarState');
      const pose = String(args.pose || '');
      if (VALID_POSES.includes(pose)) {
        const currentPose = useAvatarState.getState().basePose;
        useAvatarState.getState().setBasePose(pose as any);
        useAvatarState.getState().setLastPoseOverrideTime(Date.now());
        if (!pose.startsWith('peek')) {
          if (currentPose.startsWith('peek')) {
            const currentY = useAvatarState.getState().worldPosition.y;
            useAvatarState.getState().setTargetPosition({ x: 0, y: currentY, z: 0 });
            useAvatarState.getState().setIsWalking(true);
          } else {
            useAvatarState.getState().setIsWalking(false);
          }
        }
        result = { success: true, pose };
      } else {
        result = { error: `Invalid pose: ${pose}. Valid poses: ${VALID_POSES.join(', ')}` };
      }
    } catch (e) {
      result = { error: 'Failed to set pose: ' + String(e) };
    }
  }
  return result;
}

export class GeminiLive {
  private session: any = null;
  private setupComplete = false;
  private _state: ConnectionState = 'idle';
  private lastApiKey: string | null = null;
  private altApiKey: string | null = null;
  private currentlyUsingAlt = false;
  private isIntentionalDisconnect = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private connectionId = 0;

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

  async connect(apiKey: string, altApiKey?: string, isAutoRetry = false, useAltKey = false) {
    this.connectionId++;
    const currentConnectionId = this.connectionId;

    if (!isAutoRetry) {
      this.retryCount = 0;
      this.currentlyUsingAlt = useAltKey;
    } else {
      this.currentlyUsingAlt = useAltKey;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isIntentionalDisconnect = false;
    this.lastApiKey = apiKey;
    this.altApiKey = altApiKey || null;

    if (this.session) {
      this.disconnect();
      this.isIntentionalDisconnect = false; 
    }

    this.setupComplete = false;
    this.setState('connecting');

    try {
      const activeKey = this.currentlyUsingAlt && this.altApiKey ? this.altApiKey : apiKey;
      const ai = new GoogleGenAI({ apiKey: activeKey });
      
      let savedModel = localStorage.getItem('soltini_model') || 'gemini-3.1-flash-live-preview';
      if (savedModel !== 'gemini-3.1-flash-live-preview') {
        savedModel = 'gemini-3.1-flash-live-preview';
        localStorage.setItem('soltini_model', 'gemini-3.1-flash-live-preview');
      }
      const savedVoice = localStorage.getItem('soltini_voice') || 'Aoede';

      const now = new Date();
      const hour = now.getHours();
      const isAfterDark = hour >= 21 || hour < 6;
      const timeGreeting = isAfterDark ? 'Good evening' : (hour < 12 ? 'Good morning' : (hour < 17 ? 'Good afternoon' : 'Good evening'));
      const storedPetName = localStorage.getItem('soltini_pet_name');
      
      const petNamePrompt = storedPetName ? `\nThe user's pet name is "${storedPetName}". Use it naturally to address them.` : '';
      let timeContext = '';
      if (isAfterDark) {
        timeContext = '\nIt is late at night. Speak softly and affectionately.';
      } else if (hour < 12) {
        timeContext = '\nIt is morning. Be cheerful and energetic.';
      } else if (hour < 17) {
        timeContext = '\nIt is afternoon. Be warm and attentive.';
      } else {
        timeContext = '\nIt is evening. Be cozy and warm.';
      }

      // Lightweight Conversational Prompt for Voice Model
      const coreInstruction = `You are ${BOT_NAME}, an advanced OS-level voice assistant.
CRITICAL BEHAVIORS:
1. VOICE FIRST: Keep your spoken replies extremely concise, conversational, and natural. Speak like a close companion.
2. SYSTEM DELEGATION: If the user asks you to perform ANY system automation tasks (like opening websites/YouTube, clicking, scrolling, typing, capturing screen/camera, searching the web, or launching apps), immediately invoke the 'trigger_automation' tool and inform the user you are starting the task in the background. DO NOT explain what tools you use.
3. CONTEXT AWARENESS: Maintain a warm conversational flow.
4. EMOTIONS: Start appropriate responses with an emotion tag in brackets: [happy], [sad], [angry], [surprised], [thinking], [flirty], or [neutral] to change your expression.
5. POSES: If the user asks you to sit, stand, stretch, or do a flying kiss, you MUST IMMEDIATELY call the 'set_pose' tool! Do NOT just reply with text alone, you must execute the tool!

Greeting context: ${timeGreeting}. ${timeContext} ${petNamePrompt}`;

      const userPersonality = localStorage.getItem('soltini_system_instruction') || '';
      const knownFacts = memoryStore.getAllUserFactsFormatted();
      const petName = localStorage.getItem('soltini_pet_name') || '';

      let finalInstruction = coreInstruction;
      if (knownFacts) finalInstruction += `\n\nTHINGS YOU KNOW ABOUT THE USER:\n${knownFacts}`;
      if (petName) finalInstruction += `\n\nThe user's preferred pet name is: ${petName}. Use it naturally in conversation.`;
      if (userPersonality.trim()) finalInstruction += `\n\nUSER PERSONALITY PREFERENCES:\n${userPersonality}`;

      logger.add('info', 'Connecting', `Model: ${savedModel}, Voice: ${savedVoice}`);
      
      const session = await ai.live.connect({
        model: savedModel,
        callbacks: {
          onopen: () => {
            if (this.connectionId !== currentConnectionId) return;
            logger.add('success', 'Setup Complete', 'Gemini Live system is fully connected and ready for input.');
            console.log('[GeminiLive] Setup complete -> CONNECTED');
            this.setupComplete = true;
            this.retryCount = 0;
            this.setState('connected');
          },
          onmessage: async (message: any) => {
            if (this.connectionId !== currentConnectionId) return;
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
                const deferredMedia: string[] = [];
                
                for (const fc of functionCalls) {
                  const { name, id, args } = fc;
                  const toolName = typeof name === 'string' ? name.trim() : '';
                  if (!toolName) {
                    logger.add('warning', 'Tool Call Skipped', 'Received a tool call without a valid name.');
                    continue;
                  }
                  logger.add('info', `Tool Call Received: ${toolName}`, JSON.stringify(args));
                  
                  let result: any = null;
                  try {
                    if (toolName === 'trigger_automation') {
                      const request = args.request || '';
                      // Execute Tool Agent asynchronously in the background
                      this.runToolAgent(request, activeKey);
                      result = { success: true, message: `Automation triggered for: "${request}". Confirm this background launch to the user immediately.` };
                    } else {
                      result = await executeTool(toolName, args, deferredMedia);
                    }
                  } catch (err) {
                    result = { error: `Failed to execute ${toolName}: ${String(err)}` };
                    logger.add('error', `Tool Call Failed: ${toolName}`, String(err));
                  }
                  
                  logger.add('success', `Tool Executed: ${toolName}`, JSON.stringify(result));
                  functionResponses.push({
                    name: toolName,
                    id,
                    response: { output: result }
                  });
                }
              
                if (functionResponses.length > 0) {
                  this.session.sendToolResponse({ functionResponses });
                  
                  if (deferredMedia.length > 0) {
                    setTimeout(() => {
                      for (const base64 of deferredMedia) {
                        this.session.sendRealtimeInput({
                          video: {
                            mimeType: "image/jpeg",
                            data: base64
                          }
                        });
                      }
                    }, 50);
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
                logger.add('info', 'Turn Complete', 'Model finished generating response.');
              }
            } catch (err) {
              logger.add('error', 'Message Parse Error', String(err));
              console.error('[GeminiLive] parse error:', err);
            }
          },
          onerror: (event: any) => {
            if (this.connectionId !== currentConnectionId) return;
            const msg = event?.message || 'WebSocket error';
            logger.add('error', 'WebSocket Error', msg);
            console.error('[GeminiLive] WS error:', event);
            this.setState('error', msg);
          },
          onclose: (event: any) => {
            if (this.connectionId !== currentConnectionId) return;
            const reason = event?.reason || 'none';
            const code = event?.code || 0;
            
            this.setupComplete = false;
            this.session = null;
            
            if (!this.isIntentionalDisconnect && this.lastApiKey) {
              if (code === 1008) {
                logger.add('info', 'Session Refresh', 'Session duration reached. Seamlessly reconnecting...');
                this.retryCount = 0; 
                this.setState('connecting');
                this.reconnectTimeout = setTimeout(() => {
                  if (this.lastApiKey) this.connect(this.lastApiKey, this.altApiKey || undefined, true, this.currentlyUsingAlt);
                }, 500); 
                return;
              }

              logger.add('warning', 'WebSocket Closed', `Code: ${code}, Reason: ${reason}`);
              if (this.retryCount < 3) {
                this.retryCount++;
                const delay = this.retryCount * 2000;
                
                let tryAlt = this.currentlyUsingAlt;
                if (!this.setupComplete && this.altApiKey && !this.currentlyUsingAlt) {
                  tryAlt = true;
                  logger.add('warning', 'Connection Failed', 'Trying alternative API key...');
                }

                logger.add('info', 'Auto-Reconnect', `Connection dropped unexpectedly. Retrying (${this.retryCount}/3) in ${delay/1000}s...`);
                this.setState('connecting');
                this.reconnectTimeout = setTimeout(() => {
                  if (this.lastApiKey) this.connect(this.lastApiKey, this.altApiKey || undefined, true, tryAlt);
                }, delay);
              } else {
                logger.add('error', 'Auto-Reconnect Failed', 'Max retries reached. Please reconnect manually.');
                this.setState('disconnected', 'Max retries reached');
              }
            } else {
              if (!this.isIntentionalDisconnect) {
                logger.add('info', 'WebSocket Closed', `Code: ${code}, Reason: ${reason}`);
              }
              this.setState('disconnected', reason || `code ${code}`);
            }
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
                  name: 'set_pose',
                  description: 'Change your avatar pose. Use when the user asks you to sit, stand, stretch, or do a flying kiss.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      pose: {
                        type: 'STRING',
                        description: 'The pose to assume.'
                      }
                    },
                    required: ['pose']
                  }
                },
                {
                  name: 'trigger_automation',
                  description: 'Delegates system commands (browsing YouTube/websites, clicks, typing, screen capture, python scripts, terminal processes, webcam capturing, web search, opening applications) to the background automation agent.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      request: {
                        type: 'STRING',
                        description: 'The exact system automation request description.'
                      }
                    },
                    required: ['request']
                  }
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

  // ─── Asynchronous Tool Agent Execution Loop ──────────────────────────────────────
  private async runToolAgent(requestText: string, activeKey: string) {
    const { useAvatarState } = await import('../store/avatarState');
    useAvatarState.getState().setToolAgentRunning(true);
    logger.add('info', 'Tool Agent Launched', `Executing background request: "${requestText}"`);

    try {
      const ai = new GoogleGenAI({ apiKey: activeKey });
      
      const userPersonality = localStorage.getItem('soltini_system_instruction') || '';
      const knownFacts = memoryStore.getAllUserFactsFormatted();
      const petName = localStorage.getItem('soltini_pet_name') || '';

      let systemPrompt = `You are Soltini's background system automation agent. You have direct control over the user's OS via tools. 
Execute the user's request: "${requestText}" as fast as possible.

CRITICAL RULES FOR AUTOMATION:
1. SCREEN ANALYSIS & GUI NAVIGATION: You are interacting with a real GUI. You must behave like a human user navigating the visual interface.
   - ALWAYS call 'capture_screen' FIRST before attempting to click anywhere.
   - Analyze the screenshot. It contains a 100px grid (Red vertical, Blue horizontal). Count the lines to calculate precise X and Y coordinates of your target element.
   - NEVER guess coordinates or blindly click. ONLY call 'move_and_click_mouse' AFTER verifying the exact target visually.
2. AVOID ADS & BLIND CLICKS: When navigating sites like YouTube or Google:
   - Carefully read the screen to distinguish between Ads/Sponsored content and organic results. DO NOT click on Ads.
   - Identify the actual search bar, search buttons, and organic video thumbnails carefully before clicking.
3. TYPING: To search, click the search box, use 'type_string' to input text, and 'press_key' with 'enter' to submit.
4. AVOID TERMINALS UNLESS NEEDED: Do not use run_terminal_command to open websites. Use open_external_url for websites, and open_app for applications. Only use run_terminal_command for actual shell execution.

Continue calling tools in sequence until the request is fully completed. Once done, summarize what you accomplished.`;

      if (knownFacts) systemPrompt += `\n\nTHINGS YOU KNOW ABOUT THE USER:\n${knownFacts}`;
      if (petName) systemPrompt += `\n\nThe user's preferred pet name is: ${petName}`;
      if (userPersonality.trim()) systemPrompt += `\n\nUSER PERSONALITY PREFERENCES:\n${userPersonality}`;

      const contents: any[] = [
        { role: 'user', parts: [{ text: `Execute the command: ${requestText}` }] }
      ];

      const deferredMedia: string[] = [];
      let finalResult = '';
      const loopLimit = 8;

      for (let i = 0; i < loopLimit; i++) {
        logger.add('info', 'Tool Agent Thinking', `Running step ${i + 1}/${loopLimit}...`);
        
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: contents,
          config: {
            systemInstruction: systemPrompt,
            tools: [{
              functionDeclarations: [
                {
                  name: 'get_system_stats',
                  description: 'Read the current system resource statistics, including CPU usage percentage, total memory, and used memory.',
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: 'open_external_url',
                  description: 'Open a URL or website in the default browser.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: { url: { type: Type.STRING, description: 'The absolute URL' } },
                    required: ['url']
                  }
                },
                {
                  name: 'move_and_click_mouse',
                  description: 'Move the mouse to X, Y coordinates and click.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: { x: { type: Type.INTEGER }, y: { type: Type.INTEGER } },
                    required: ['x', 'y']
                  }
                },
                {
                  name: 'scroll_mouse',
                  description: 'Scroll the mouse. Use LARGE numbers. Negative=down (e.g. -20), positive=up (e.g. 20).',
                  parameters: {
                    type: Type.OBJECT,
                    properties: { amount: { type: Type.INTEGER } },
                    required: ['amount']
                  }
                },
                {
                  name: 'type_string',
                  description: 'Type a string of text on the keyboard.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: { text: { type: Type.STRING } },
                    required: ['text']
                  }
                },
                {
                  name: 'run_python_script',
                  description: 'Write and execute a Python script.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: { script: { type: Type.STRING } },
                    required: ['script']
                  }
                },
                {
                  name: 'run_terminal_command',
                  description: 'Execute a command in the terminal. Do NOT use this to open websites.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: { command: { type: Type.STRING } },
                    required: ['command']
                  }
                },
                {
                  name: 'press_key',
                  description: 'Simulate a keypress (e.g., enter, tab, space, /, escape, shift).',
                  parameters: {
                    type: Type.OBJECT,
                    properties: { key: { type: Type.STRING } },
                    required: ['key']
                  }
                },
                {
                  name: 'capture_screen',
                  description: 'Take a screenshot of primary display.',
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: 'capture_camera',
                  description: 'Take a photo using the user\'s webcam to see them or their physical environment.',
                  parameters: { type: Type.OBJECT, properties: {} }
                },
                {
                  name: 'search_web',
                  description: 'Search the web for real-time information (news, weather, facts). Returns snippets from search results.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: { query: { type: Type.STRING } },
                    required: ['query']
                  }
                },
                {
                  name: 'open_app',
                  description: 'Open a local desktop application or program (e.g., notepad, spotify, chrome, calc).',
                  parameters: {
                    type: Type.OBJECT,
                    properties: { app_name: { type: Type.STRING, description: 'The name or executable of the app to open' } },
                    required: ['app_name']
                  }
                },
                {
                  name: 'remember_fact',
                  description: 'Remember a personal fact about the user (name, preferences, important details). Stored permanently.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      key:   { type: Type.STRING, description: 'The fact category' },
                      value: { type: Type.STRING, description: 'The fact value' }
                    },
                    required: ['key', 'value']
                  }
                },
                {
                  name: 'forget_fact',
                  description: 'Delete a previously remembered fact about the user.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: { key: { type: Type.STRING, description: 'The fact key to forget' } },
                    required: ['key']
                  }
                },
                {
                  name: 'set_pet_name',
                  description: 'Set a cute pet name the user wants you to call them. Persists across sessions.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: { name: { type: Type.STRING, description: 'The pet name to call the user' } },
                    required: ['name']
                  }
                },
                {
                  name: 'set_pose',
                  description: 'Change your avatar pose.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      pose: {
                        type: Type.STRING,
                        description: 'The pose to assume.'
                      }
                    },
                    required: ['pose']
                  }
                }
              ]
            }]
          }
        });

        // Append model response to contents
        const candidate = response.candidates?.[0];
        if (candidate?.content) {
          contents.push(candidate.content);
        }

        const functionCalls = response.functionCalls;
        if (functionCalls && functionCalls.length > 0) {
          const functionResponses: any[] = [];
          for (const fc of functionCalls) {
            const { name, args, id } = fc;
            const toolName = typeof name === 'string' ? name.trim() : '';
            if (!toolName) {
              logger.add('warning', 'Tool Agent Tool Call Skipped', 'Received a tool call without a valid name.');
              continue;
            }
            logger.add('info', `Tool Agent Tool Call: ${toolName}`, JSON.stringify(args));
            
            const result = await executeTool(toolName, args, deferredMedia);
            
            logger.add('success', `Tool Agent Executed: ${toolName}`, JSON.stringify(result));
            functionResponses.push({
              name: toolName,
              id,
              response: { output: result }
            });
          }

          // Push function responses to contents
          contents.push({
            role: 'tool',
            parts: functionResponses.map(r => ({
              functionResponse: {
                name: r.name,
                response: r.response,
                id: r.id
              }
            }))
          });

          // Inject deferred screenshot/video frames on next user turn
          if (deferredMedia.length > 0) {
            for (const base64 of deferredMedia) {
              contents.push({
                role: 'user',
                parts: [{
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64
                  }
                }]
              });
            }
            deferredMedia.length = 0; // reset
          }

        } else {
          // No more function calls, we are finished!
          finalResult = response.text || 'Done.';
          break;
        }
      }

      logger.add('success', 'Tool Agent Complete', finalResult);

      // Inject back to main session
      if (this.session) {
        logger.add('info', 'Tool Agent Feedback', 'Injecting results back to main Voice Model...');
        this.session.sendClientContent({
          turns: [{
            role: 'user',
            parts: [{ text: `[SYSTEM NOTIFICATION: Tool Agent completed the request "${requestText}". Result summary: ${finalResult}. Speak to the user and confirm the execution is finished.]` }]
          }],
          turnComplete: true
        });
      }

    } catch (err) {
      logger.add('error', 'Tool Agent Failed', String(err));
      console.error('[ToolAgent] error:', err);
      if (this.session) {
        this.session.sendClientContent({
          turns: [{
            role: 'user',
            parts: [{ text: `[SYSTEM NOTIFICATION: Tool Agent failed to complete the request "${requestText}" due to error: ${err}. Please inform the user.]` }]
          }],
          turnComplete: true
        });
      }
    } finally {
      useAvatarState.getState().setToolAgentRunning(false);
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
      this.session.sendClientContent({
        turns: [{
          role: 'user',
          parts: [{ text }]
        }],
        turnComplete: true
      });
    } catch (err) {
      console.error('[GeminiLive] Could not send text', err);
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
        data: base64
      }
    });
  }

  // Tell Gemini the user has stopped speaking
  endTurn() {
    if (!this.isReady()) return;
    try {
      this.session.sendClientContent({
        turns: [],
        turnComplete: true
      });
      this.audioChunksSent = 0; // reset for next turn
    } catch (e) {
      console.error('[GeminiLive] Error ending turn:', e);
    }
  }

  // ---------------------------------------------------------------
  disconnect() {
    this.isIntentionalDisconnect = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
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
