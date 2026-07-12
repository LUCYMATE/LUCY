import { GoogleGenAI } from '@google/genai';
import { logger } from './logger';

export interface MemoryFact {
  id: string;
  text: string;
  embedding: number[];
  createdAt: number;
}

export class VectorMemoryManager {
  private memories: MemoryFact[] = [];
  private readonly STORAGE_KEY = 'soltini_vector_memory';
  
  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        this.memories = JSON.parse(data);
      }
    } catch (e) {
      console.error('Failed to load vector memory:', e);
      this.memories = [];
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.memories));
      window.dispatchEvent(new CustomEvent('soltini-memory-updated'));
    } catch (e) {
      console.error('Failed to save vector memory:', e);
      // In case localStorage is full due to embeddings, we might want to log a warning
      logger.add('error', 'Memory Save Failed', 'Storage might be full. Clear some memories.');
    }
  }

  public getMemories(): MemoryFact[] {
    return [...this.memories].sort((a, b) => b.createdAt - a.createdAt);
  }

  public deleteMemory(id: string) {
    this.memories = this.memories.filter(m => m.id !== id);
    this.saveToStorage();
    logger.add('info', 'Memory System', `Deleted memory: ${id}`);
  }

  public clearAll() {
    this.memories = [];
    this.saveToStorage();
    logger.add('info', 'Memory System', 'Cleared all memories.');
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private async generateEmbedding(text: string, apiKey: string): Promise<number[] | null> {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: text
      });
      if (response.embeddings && response.embeddings.length > 0) {
        return response.embeddings[0].values || null;
      }
      return null;
    } catch (err) {
      console.error('Failed to generate embedding:', err);
      return null;
    }
  }

  public async saveFact(text: string, apiKey: string): Promise<boolean> {
    const embedding = await this.generateEmbedding(text, apiKey);
    if (!embedding) return false;

    // Check if a highly similar fact already exists to prevent duplicates
    const searchResults = this.search(embedding, 1);
    if (searchResults.length > 0 && searchResults[0].score > 0.95) {
      logger.add('info', 'Memory System', `Fact already known: "${text}"`);
      return true; // Consider it successful since we already know it
    }

    const memory: MemoryFact = {
      id: crypto.randomUUID(),
      text,
      embedding,
      createdAt: Date.now()
    };
    this.memories.push(memory);
    this.saveToStorage();
    logger.add('success', 'Memory System', `Saved new fact: "${text}"`);
    return true;
  }

  public search(queryEmbedding: number[], topK: number = 3): { fact: MemoryFact, score: number }[] {
    const scored = this.memories.map(fact => ({
      fact,
      score: this.cosineSimilarity(queryEmbedding, fact.embedding)
    }));
    
    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);
    
    // Return top K that meet a minimum relevance threshold (e.g., 0.5)
    return scored.filter(s => s.score > 0.5).slice(0, topK);
  }

  public async searchWithText(query: string, apiKey: string, topK: number = 5): Promise<string[]> {
    if (this.memories.length === 0) return [];
    
    const embedding = await this.generateEmbedding(query, apiKey);
    if (!embedding) return [];

    const results = this.search(embedding, topK);
    return results.map(r => r.fact.text);
  }
}

export const vectorMemory = new VectorMemoryManager();
