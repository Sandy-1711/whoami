// Embedding port — the abstract side of text embedding, mirroring the LlmProvider
// port. Evidence code depends only on `Embedder`; the Gemini adapter
// (llm/providers/gemini-embedder.ts) implements it over the injected HttpClient
// so it stays unit-testable with a fake. No vector DB: the evidence set is small
// (<=200 units), so callers keep vectors in a plain JSON cache and compare with
// cosine (see evidence/embedding.ts).
import type { HttpClient } from './http.js';

export interface Embedder {
  readonly id: string;    // 'gemini'
  readonly label: string; // 'Gemini'
  readonly model: string; // 'gemini-embedding-001'
  // Embed a batch of texts → one vector per input, order-preserving. Empty input
  // returns an empty array without a network call.
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbedderConfig {
  apiKey: string;
  model: string;
  http: HttpClient;
}
