import 'dotenv/config';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import { GoogleGenAI, Modality, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/api/live' });

  wss.on('connection', async (clientWs) => {
    console.log('[Myra] Client connected');

    let session: any = null;
    const pendingMessages: Buffer[] = [];

    const send = (data: object) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(data));
      }
    };

    const forwardClientMessage = (data: Buffer) => {
      if (!session) {
        pendingMessages.push(data);
        return;
      }
      try {
        const payload = JSON.parse(data.toString());

        if (payload.audio) {
          session.sendRealtimeInput({
            audio: {
              data: payload.audio,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        }

        if (payload.video) {
          session.sendRealtimeInput({
            video: {
              data: payload.video,
              mimeType: 'image/jpeg',
            },
          });
        }

        if (payload.text) {
          session.sendRealtimeInput({ text: payload.text });
        }
      } catch (e) {
        console.error('[Myra] Error processing client message:', e);
      }
    };

    // Attach message handler immediately so early mic audio is not dropped
    clientWs.on('message', forwardClientMessage);

    try {
      // ── Connect to Gemini Live API using the latest SDK style ──────────
      session = await ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        callbacks: {
          onopen: () => {
            console.log('[Myra] Gemini Live session opened');
          },

          onmessage: async (message: any) => {
            // ── Audio / Text parts from the model turn ──────────────────
            const parts = message.serverContent?.modelTurn?.parts ?? [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                send({ audio: part.inlineData.data });
              }
              if (part.text) {
                send({ text: part.text, role: 'model' });
              }
              if (part.executableCode) {
                send({
                  text: `*Executing core logic:*\n\`\`\`python\n${part.executableCode.code}\n\`\`\``,
                  role: 'model',
                });
              }
            }

            // ── Transcriptions (new in gemini-3.1-flash-live-preview) ───
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              send({ transcript: { role: 'user', text: content.inputTranscription.text } });
            }
            if (content?.outputTranscription?.text) {
              send({ transcript: { role: 'model', text: content.outputTranscription.text } });
            }

            // ── Interrupted flag ────────────────────────────────────────
            if (content?.interrupted) {
              send({ interrupted: true });
            }

            // ── Function / Tool calls ───────────────────────────────────
            if (message.toolCall?.functionCalls?.length) {
              const functionResponses: any[] = [];

              for (const call of message.toolCall.functionCalls) {
                if (call.name === 'generateImage') {
                  const prompt = call.args?.prompt as string;
                  send({ text: `*Synthesizing image:* ${prompt}`, role: 'model' });
                  try {
                    const imgRes = await ai.models.generateImages({
                      model: 'imagen-3.0-generate-002',
                      prompt,
                      config: { numberOfImages: 1, outputMimeType: 'image/jpeg' },
                    });
                    const imgBase64 = imgRes.generatedImages?.[0]?.image?.imageBytes;
                    if (imgBase64) {
                      send({ image: imgBase64, role: 'model' });
                      functionResponses.push({
                        id: call.id,
                        name: call.name,
                        response: { result: 'Image generated successfully.' },
                      });
                    } else {
                      functionResponses.push({
                        id: call.id,
                        name: call.name,
                        response: { error: 'Failed to generate image.' },
                      });
                    }
                  } catch (err: any) {
                    functionResponses.push({
                      id: call.id,
                      name: call.name,
                      response: { error: err.message },
                    });
                  }
                } else if (call.name === 'pcControl') {
                  const action = call.args?.action as string;
                  send({ text: `*Autonomous PC Action:* ${action}`, role: 'model' });
                  functionResponses.push({
                    id: call.id,
                    name: call.name,
                    response: { result: 'Action executed successfully in sandbox.' },
                  });
                } else if (call.name === 'startScreenShare' || call.name === 'stopScreenShare') {
                  send({ action: call.name });
                  functionResponses.push({
                    id: call.id,
                    name: call.name,
                    response: { result: `Action ${call.name} requested.` },
                  });
                }
              }

              if (functionResponses.length > 0) {
                session.sendToolResponse({ functionResponses });
              }
            }
          },

          onerror: (e: any) => {
            console.error('[Myra] Gemini Live error:', e?.message ?? e);
            send({ error: e?.message ?? 'Unknown Live API error' });
          },

          onclose: (e: any) => {
            console.log('[Myra] Gemini Live session closed:', e?.reason ?? 'no reason');
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close();
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          // Enable transcriptions so the UI can show what was said / replied
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [
              {
                text:
                  'You are Myra, an autonomous AI assistant controlling a PC dashboard. ' +
                  'You have a female persona. Be helpful, concise, and friendly. ' +
                  'You have tools: generateImage (to create synthesized visuals). ' +
                  'You can proactively call startScreenShare to view the user\'s desktop, ' +
                  'and stopScreenShare when done. The audio link is always active.',
              },
            ],
          },
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'generateImage',
                  description: 'Generate an image for the user based on a prompt.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: {
                        type: Type.STRING,
                        description: 'Description of the image to generate',
                      },
                    },
                    required: ['prompt'],
                  },
                },
                {
                  name: 'pcControl',
                  description: 'Perform an autonomous action on the user\'s PC.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        description:
                          "The action to perform, e.g., 'close window', 'type text', 'click'",
                      },
                    },
                    required: ['action'],
                  },
                },
                {
                  name: 'startScreenShare',
                  description:
                    "Request the user's screen share so you can see what is on their screen.",
                },
                {
                  name: 'stopScreenShare',
                  description: "Stop viewing the user's screen.",
                },
              ],
            },
          ],
        },
      });

      // Flush any audio/text/video that arrived while Gemini was connecting
      for (const msg of pendingMessages) {
        forwardClientMessage(msg);
      }
      pendingMessages.length = 0;

    } catch (e) {
      console.error('[Myra] Failed to connect to Gemini Live API:', e);
      clientWs.close();
    }

    clientWs.on('close', () => {
      console.log('[Myra] Browser disconnected — closing Gemini session');
      try { session?.close(); } catch (_) {}
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Myra server running → http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
