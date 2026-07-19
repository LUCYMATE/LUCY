import { create } from 'zustand';

export type Role = 'user' | 'model';

export interface Message {
  id: string;
  role: Role;
  text: string;
}

interface ChatState {
  activeChatId: string;
  messages: Message[];
  input: string;
  setInput: (input: string) => void;
  setActiveChatId: (id: string) => void;
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  addMessage: (message: Message) => void;
  appendMessageText: (id: string, text: string) => void;
  resetMessages: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeChatId: crypto.randomUUID(),
  messages: [],
  input: '',
  setInput: (input) => set({ input }),
  setActiveChatId: (id) => set({ activeChatId: id }),
  setMessages: (updater) => set((state) => ({
    messages: typeof updater === 'function' ? updater(state.messages) : updater
  })),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  appendMessageText: (id, text) => set((state) => ({
    messages: state.messages.map(m => m.id === id ? { ...m, text: m.text + text } : m)
  })),
  resetMessages: () => set({ messages: [], activeChatId: crypto.randomUUID() })
}));
