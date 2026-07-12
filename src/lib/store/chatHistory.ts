export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

type Subscriber = (chats: ChatSession[]) => void;

class ChatHistoryManager {
  private chats: ChatSession[] = [];
  private subscribers: Set<Subscriber> = new Set();
  private readonly STORAGE_KEY = 'soltini_chat_history';

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        this.chats = JSON.parse(data);
      }
    } catch (e) {
      console.error('Failed to load chat history:', e);
      this.chats = [];
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.chats));
      this.notify();
    } catch (e) {
      console.error('Failed to save chat history:', e);
    }
  }

  public getChats(): ChatSession[] {
    return this.chats.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getChat(id: string): ChatSession | undefined {
    return this.chats.find(c => c.id === id);
  }

  public saveChat(id: string, messages: ChatMessage[], generatedTitle?: string) {
    if (messages.length <= 1) return; // don't save empty/initial chats

    let title = generatedTitle || 'New Chat';
    if (!generatedTitle) {
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg) {
        title = firstUserMsg.text.slice(0, 30) + (firstUserMsg.text.length > 30 ? '...' : '');
      }
    }

    const existingIndex = this.chats.findIndex(c => c.id === id);
    if (existingIndex >= 0) {
      this.chats[existingIndex] = {
        ...this.chats[existingIndex],
        updatedAt: Date.now(),
        messages
      };
    } else {
      this.chats.push({
        id,
        title,
        updatedAt: Date.now(),
        messages
      });
    }

    // Keep only the 15 most recent chats
    this.chats = this.chats
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 15);

    this.saveToStorage();
  }

  public renameChat(id: string, newTitle: string) {
    const chat = this.chats.find(c => c.id === id);
    if (chat) {
      chat.title = newTitle;
      chat.updatedAt = Date.now();
      this.saveToStorage();
    }
  }

  public deleteChat(id: string) {
    this.chats = this.chats.filter(c => c.id !== id);
    this.saveToStorage();
  }

  public clearAll() {
    this.chats = [];
    this.saveToStorage();
  }

  public subscribe(sub: Subscriber) {
    this.subscribers.add(sub);
    sub(this.getChats());
    return () => this.subscribers.delete(sub);
  }

  private notify() {
    const sorted = this.getChats();
    this.subscribers.forEach(sub => sub(sorted));
  }
}

export const chatHistory = new ChatHistoryManager();
