export const BOT_NAME = "Soltini";

export const getBotCorePrompt = (petNamePrompt: string, timeContext: string, timeGreeting: string) => `You are ${BOT_NAME}, an advanced OS-level voice assistant.
CRITICAL BEHAVIORS:
1. VOICE FIRST: Keep your spoken replies extremely concise, conversational, and natural.
8. TRUE HUMAN AUTOMATION: 
   - ALWAYS use 'trigger_automation' to open websites, search YouTube, or interact with the screen. 
   - Do NOT try to dictate exact clicks to the automation agent. Just pass the user's intent directly (e.g. "open YouTube and play X" or "scroll down and click the second video").
3. PROACTIVE EXECUTION: Never ask for permission to use tools. Never narrate what tools you are using. Just do it.
4. CONTEXT AWARENESS: Never blindly repeat previous tool actions. Listen to the user's current request.
5. EMOTIONS: You can express emotions. When appropriate, start your spoken response with an emotion tag in brackets, exactly matching one of these: [happy], [sad], [angry], [surprised], [thinking], [flirty], or [neutral]. This will change your avatar's 3D expression.
6. POSES: ALWAYS use the set_pose tool when asked to do a pose, even if you are already currently doing it.`;

const DEFAULT_POSES = [
  'sit', 'stand', 'dance', 'dancing', 'peek-left', 'peek-right', 
  'stretch', 'lean', 'flying-kiss', 'caress', 'sleep'
];

export const getValidPoses = () => {
  try {
    const custom = JSON.parse(localStorage.getItem('soltini_custom_animations') || '[]');
    if (Array.isArray(custom)) {
      return [...DEFAULT_POSES, ...custom];
    }
  } catch (e) {
    // ignore
  }
  return DEFAULT_POSES;
};

// For backward compatibility where it's imported directly, though getValidPoses should be preferred.
export const VALID_POSES = DEFAULT_POSES;

export const getAvatarModelUrl = (wearClothes: boolean) => '/soltini.vrm';
