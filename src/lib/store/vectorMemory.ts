import { GoogleGenAI } from '@google/genai';
import { logger } from './logger';
import { userAuth } from '../auth/userAuth';
import { emitCrossWindow } from '../events/crossWindowEventBus';

export interface MemoryFact {
  id: string;
  text: string;
  embedding: number[];
  createdAt: number;
}

export class VectorMemoryManager {
  private memories: MemoryFact[] = [];
  private readonly STORAGE_KEY = 'lucy_vector_memory';
  
  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        const parsed: unknown = JSON.parse(data);
        this.memories = Array.isArray(parsed) ? parsed.filter((memory): memory is MemoryFact =>
          !!memory && typeof memory.id === 'string' && memory.id.length <= 200 &&
          typeof memory.text === 'string' && memory.text.length <= 10_000 &&
          Number.isFinite(memory.createdAt) && Array.isArray(memory.embedding) &&
          memory.embedding.length > 0 && memory.embedding.length <= 2048 &&
          memory.embedding.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
        ).slice(-500) : [];
      }
    } catch (e) {
      console.error('Failed to load vector memory:', e);
      this.memories = [];
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.memories));
      emitCrossWindow('lucy-memory-updated');
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
    const ai = new GoogleGenAI({ apiKey });

    // 1. Primary: gemini-embedding-2 (multimodal native embedding)
    try {
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-2',
        contents: text,
      });
      if (response.embeddings && response.embeddings.length > 0 && response.embeddings[0].values) {
        return response.embeddings[0].values;
      }
    } catch (err: any) {
      console.warn('[VectorMemory] gemini-embedding-2 attempt failed, trying text-embedding-004 fallback:', err?.message || err);
    }

    // 2. Resilient fallback: text-embedding-004
    try {
      const response = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: text
      });
      if (response.embeddings && response.embeddings.length > 0 && response.embeddings[0].values) {
        return response.embeddings[0].values;
      }
    } catch (err: any) {
      console.warn('[VectorMemory] text-embedding-004 fallback failed, trying gemini-embedding-001:', err?.message || err);
    }

    // 3. Fallback: gemini-embedding-001
    try {
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: text
      });
      if (response.embeddings && response.embeddings.length > 0 && response.embeddings[0].values) {
        return response.embeddings[0].values;
      }
      return 'No embeddings returned from Gemini';
    } catch (err: any) {
      console.error('Failed to generate embedding fallback:', err);
      return err.message || String(err);
    }
  }

  public async saveFact(text: string, apiKey: string): Promise<{ success: boolean, error?: string }> {
    if (!text.trim() || text.length > 10_000) {
      return { success: false, error: 'Fact text must contain 1 to 10,000 characters' };
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
    if (this.memories.length >= 500) this.memories.shift();
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
