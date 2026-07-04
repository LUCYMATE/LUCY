export interface UserFacts {
  [key: string]: string;
}

export interface ChatSummary {
  chatId: string;
  summary: string;
  updatedAt: number;
}

type Subscriber = () => void;

class MemoryStore {
  private facts: UserFacts = {};
  private summaries: ChatSummary[] = [];
  private subscribers: Set<Subscriber> = new Set();
  private readonly FACTS_KEY = 'syra_user_facts';
  private readonly SUMMARIES_KEY = 'syra_chat_summaries';

  constructor() {
    this.load();
  }

  private load() {
    try {
      const factsData = localStorage.getItem(this.FACTS_KEY);
      if (factsData) this.facts = JSON.parse(factsData);
      const summariesData = localStorage.getItem(this.SUMMARIES_KEY);
      if (summariesData) this.summaries = JSON.parse(summariesData);
    } catch (e) {
      console.warn('Failed to load memory store:', e);
    }
  }

  private save() {
    try {
      localStorage.setItem(this.FACTS_KEY, JSON.stringify(this.facts));
      localStorage.setItem(this.SUMMARIES_KEY, JSON.stringify(this.summaries));
    } catch (e) {
      console.warn('Failed to save memory store:', e);
    }
    this.notify();
  }

  setUserFact(key: string, value: string) {
    this.facts[key] = value;
    this.save();
  }

  getUserFact(key: string): string | undefined {
    return this.facts[key];
  }

  getAllUserFacts(): UserFacts {
    return { ...this.facts };
  }

  deleteUserFact(key: string) {
    delete this.facts[key];
    this.save();
  }

  clearAllUserFacts() {
    this.facts = {};
    this.save();
  }

  getAllUserFactsFormatted(): string {
    const entries = Object.entries(this.facts);
    if (entries.length === 0) return '';
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
  }

  getChatSummary(chatId: string): string | undefined {
    return this.summaries.find(s => s.chatId === chatId)?.summary;
  }

  setChatSummary(chatId: string, summary: string) {
    const existing = this.summaries.findIndex(s => s.chatId === chatId);
    if (existing >= 0) {
      this.summaries[existing] = { chatId, summary, updatedAt: Date.now() };
    } else {
      this.summaries.push({ chatId, summary, updatedAt: Date.now() });
    }
    this.save();
  }

  deleteChatSummary(chatId: string) {
    this.summaries = this.summaries.filter(s => s.chatId !== chatId);
    this.save();
  }

  getRecentSummaries(maxCount = 3): string {
    return this.summaries
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, maxCount)
      .map(s => s.summary)
      .join(' | ');
  }

  subscribe(sub: Subscriber) {
    this.subscribers.add(sub);
    return () => this.subscribers.delete(sub);
  }

  private notify() {
    this.subscribers.forEach(sub => sub());
  }
}

export const memoryStore = new MemoryStore();
