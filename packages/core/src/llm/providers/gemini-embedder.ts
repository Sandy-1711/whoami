// Gemini embedding adapter. Talks to the Generative Language batch-embed endpoint
// through the injected HttpClient and implements the Embedder port. Model MUST be
// gemini-embedding-001 — text-embedding-004 404s on this key (verified 2026-07).
// Requests are chunked so a large ingest stays under the batch size cap.
import type { HttpClient } from '../../ports/http.js';
import type { Embedder, EmbedderConfig } from '../../ports/embedding.js';

export const GEMINI_EMBED_MODEL = 'gemini-embedding-001';

// The batch endpoint accepts up to 100 requests; keep a margin.
const BATCH = 100;

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`;

class GeminiEmbedder implements Embedder {
  readonly id = 'gemini';
  readonly label = 'Gemini';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly http: HttpClient,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      out.push(...(await this.embedBatch(texts.slice(i, i + BATCH))));
    }
    return out;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await this.http.post(`${endpoint(this.model)}?key=${this.apiKey}`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${this.model}`,
          content: { parts: [{ text }] },
        })),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini embed API ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { embeddings?: { values?: number[] }[] };
    const embeddings = data?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new Error(`Gemini embed returned ${embeddings?.length ?? 0} vectors for ${texts.length} inputs.`);
    }
    return embeddings.map((e, i) => {
      const v = e?.values;
      if (!Array.isArray(v) || !v.length) throw new Error(`Gemini embed returned no vector for input ${i}.`);
      return v;
    });
  }
}

export function createGeminiEmbedder({ apiKey, model, http }: EmbedderConfig): Embedder {
  return new GeminiEmbedder(apiKey, model || GEMINI_EMBED_MODEL, http);
}
