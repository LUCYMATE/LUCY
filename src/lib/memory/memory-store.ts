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
  private readonly FACTS_KEY = 'lucy_user_facts';
  private readonly SUMMARIES_KEY = 'lucy_chat_summaries';

  constructor() {
    this.load();
  }

  private load() {
    try {
      const factsData = localStorage.getItem(this.FACTS_KEY);
      if (factsData) {
        const parsed: unknown = JSON.parse(factsData);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          this.facts = Object.fromEntries(Object.entries(parsed).filter(([key, value]) =>
            key.length <= 500 && typeof value === 'string' && value.length <= 10_000
          ).slice(0, 2000));
        }
      }
      const summariesData = localStorage.getItem(this.SUMMARIES_KEY);
      if (summariesData) {
        const parsed: unknown = JSON.parse(summariesData);
        this.summaries = Array.isArray(parsed) ? parsed.filter((summary): summary is ChatSummary =>
          !!summary && typeof summary.chatId === 'string' && summary.chatId.length <= 200 &&
          typeof summary.summary === 'string' && summary.summary.length <= 20_000 && Number.isFinite(summary.updatedAt)
        ).slice(-500) : [];
      }
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
    if (!key.trim() || key.length > 500 || value.length > 10_000 || Object.keys(this.facts).length >= 2000 && !(key in this.facts)) return;
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
