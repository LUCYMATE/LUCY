import { GoogleGenAI } from '@google/genai';
import { logger } from './logger';
import { userAuth } from '../auth/userAuth';

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

  private async generateEmbedding(text: string, apiKey: string): Promise<number[] | string> {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-2',
        contents: text
      });
      if (response.embeddings && response.embeddings.length > 0) {
        return response.embeddings[0].values || 'Embedding values array is empty';
      }
      return 'No embeddings returned from Gemini';
    } catch (err: any) {
      console.error('Failed to generate embedding:', err);
      return err.message || String(err);
    }
  }

  public async saveFact(text: string, apiKey: string): Promise<{ success: boolean, error?: string }> {
    if (!text) {
      return { success: false, error: 'Fact text was empty' };
    }

    const embeddingResult = await this.generateEmbedding(text, apiKey);
    if (typeof embeddingResult === 'string') {
      return { success: false, error: embeddingResult };
    }

    const embedding = embeddingResult as number[];

    // Check if a similar fact already exists to prevent duplicate boxes
    const searchResults = this.search(embedding, 1);
    if (searchResults.length > 0) {
      const topMatch = searchResults[0];
      if (topMatch.score > 0.90) {
        // Virtually identical fact — just update timestamp
        topMatch.fact.createdAt = Date.now();
        this.saveToStorage();
        logger.add('info', 'Memory System', `Fact updated (identical): "${text}"`);
        return { success: true };
      } else if (topMatch.score >= 0.70) {
        // Similar fact — update the existing box content rather than creating a duplicate box!
        topMatch.fact.text = text;
        topMatch.fact.embedding = embedding;
        topMatch.fact.createdAt = Date.now();
        this.saveToStorage();
        logger.add('info', 'Memory System', `Fact updated (refined): "${text}"`);
        return { success: true };
      }
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
    return { success: true };
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

  public async searchWithText(query: string, apiKey: string, topK: number = 5): Promise<{ memories: string[], error?: string }> {
    // Memory recall is restricted to Pro users
    if (!userAuth.isPro()) {
      return { memories: [], error: 'PRO_RECALL_LOCKED' };
    }

    if (this.memories.length === 0) return { memories: [] };
    
    const embeddingResult = await this.generateEmbedding(query, apiKey);
    if (typeof embeddingResult === 'string') {
      return { memories: [], error: embeddingResult };
    }

    const results = this.search(embeddingResult as number[], topK);
    return { memories: results.map(r => r.fact.text) };
  }
}

export const vectorMemory = new VectorMemoryManager();
