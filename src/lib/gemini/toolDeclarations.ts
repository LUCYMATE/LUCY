import { Type } from '@google/genai';
import { getValidPoses } from '../../config/bot-profile';

export const getLiveVoiceTools = () => [
                {
                  name: 'set_pose',
                  description: `Change your avatar pose. Use when the user asks you to do a pose or animation. Valid options: ${getValidPoses().join(', ')}`,
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
                },
                {
                  name: 'save_memory',
                  description: 'Saves an important fact about the user or their preferences into long-term memory. Use this silently when the user reveals something you should remember for the future.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      fact: {
                        type: 'STRING',
                        description: 'A concise fact to remember (e.g., "The user loves coffee", "User is a programmer").'
                      }
                    },
                    required: ['fact']
                  }
                },
                {
                  name: 'search_memory',
                  description: 'Searches long-term memory for relevant facts when you need to recall something you might have forgotten.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      query: {
                        type: 'STRING',
                        description: 'The search query to find in memory.'
                      }
                    },
                    required: ['query']
                  }
                }
              ];

export const getAutomationTools = () => [
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
                    name: 'press_key_combo',
                    description: 'Press a key combination using modifier keys. For closing browser tabs use ["ctrl","w"], for closing windows use ["alt","f4"], for switching tabs use ["ctrl","tab"]. The first key(s) are held down while the last key is pressed.',
                    parameters: {
                      type: Type.OBJECT,
                      properties: { keys: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Array of key names to press in order, e.g. ["ctrl","w"]' } },
                      required: ['keys']
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
                    name: 'close_app',
                    description: 'Forcefully close or kill a running desktop application or process (e.g., chrome, notepad). Use this instead of alt+f4 to reliably terminate tasks.',
                    parameters: {
                      type: Type.OBJECT,
                      properties: { app_name: { type: Type.STRING, description: 'The name of the app to kill (e.g., chrome, notepad)' } },
                      required: ['app_name']
                    }
                  },
                  {
                    name: 'remember_fact',
                    description: 'Remember a personal fact about the user (name, preferences, important details). Stored permanently.',
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        key: { type: Type.STRING, description: 'The fact category' },
                        value: { type: Type.STRING, description: 'The fact value' }
                      },
                      required: ['key', 'value']
                    }
                  },
                  {
                    name: 'search_memory',
                    description: 'Search the vector-style memory database for known facts about the user using keywords. Call this whenever you need to recall past preferences, names, or events.',
                    parameters: {
                      type: Type.OBJECT,
                      properties: { query: { type: Type.STRING, description: 'Space-separated keywords to search for' } },
                      required: ['query']
                    }
                  },
                  {
                    name: 'schedule_task',
                    description: 'Schedule a proactive background task or reminder. The AI will wake up and execute the instruction at the EXACT target time. ALWAYS use the current Date/Time context to calculate the target ISO string.',
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        target_time: { type: Type.STRING, description: 'Absolute target time in DD/MM/YYYY HH:MM:SS format (e.g. 10/07/2026 21:00:00)' },
                        instruction: { type: Type.STRING, description: 'The exact instruction to execute at that time' }
                      },
                      required: ['target_time', 'instruction']
                    }
                  },
                  {
                    name: 'list_scheduled_tasks',
                    description: 'List all currently scheduled background tasks along with their IDs and execution times.',
                  },
                  {
                    name: 'cancel_scheduled_task',
                    description: 'Cancel a previously scheduled background task using its ID.',
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING, description: 'The ID of the task to cancel' }
                      },
                      required: ['id']
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
                    description: `Change your avatar pose. Valid options: ${getValidPoses().join(', ')}`,
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
];
