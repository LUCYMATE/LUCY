import { create } from 'zustand';

interface EngineState {
  initSystem: () => void;
  toggleMic: () => void;
  setMicEnabled: (enabled: boolean) => void;
  sendText: (text: string) => void;
  interruptSpeech: () => void;
  setEngineMethods: (methods: Partial<EngineState>) => void;
}

export const useEngineStore = create<EngineState>((set) => ({
  initSystem: () => { console.warn('initSystem not bound to engine yet'); },
  toggleMic: () => { console.warn('toggleMic not bound to engine yet'); },
  setMicEnabled: () => { console.warn('setMicEnabled not bound to engine yet'); },
  sendText: (text: string) => { console.warn('sendText not bound to engine yet. Msg:', text); },
  interruptSpeech: () => { console.warn('interruptSpeech not bound to engine yet'); },
  setEngineMethods: (methods) => set((state) => ({ ...state, ...methods }))
}));
