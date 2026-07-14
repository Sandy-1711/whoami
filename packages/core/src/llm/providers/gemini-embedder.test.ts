import { describe, it, expect } from 'vitest';
import { createGeminiEmbedder, GEMINI_EMBED_MODEL } from './gemini-embedder.js';
import type { HttpClient, HttpRequest } from '../../ports/http.js';

// Records requests and answers with one vector per input request.
function fakeHttp(): HttpClient & { calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = [];
  return {
    calls,
    async post(url: string, req: HttpRequest) {
      const body = JSON.parse(req.body || '{}');
      calls.push({ url, body });
      const n = body.requests.length;
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ embeddings: Array.from({ length: n }, (_, i) => ({ values: [i, 1, 2] })) }),
      };
    },
  };
}

describe('createGeminiEmbedder', () => {
  it('defaults to gemini-embedding-001 and returns a vector per input', async () => {
    const http = fakeHttp();
    const e = createGeminiEmbedder({ apiKey: 'k', model: '', http });
    expect(e.model).toBe(GEMINI_EMBED_MODEL);
    const vecs = await e.embed(['a', 'b']);
    expect(vecs).toHaveLength(2);
    expect(vecs[1]).toEqual([1, 1, 2]);
    expect(http.calls[0].url).toContain(`${GEMINI_EMBED_MODEL}:batchEmbedContents?key=k`);
  });

  it('returns [] without a network call for empty input', async () => {
    const http = fakeHttp();
    const e = createGeminiEmbedder({ apiKey: 'k', model: '', http });
    expect(await e.embed([])).toEqual([]);
    expect(http.calls).toHaveLength(0);
  });

  it('chunks large inputs into multiple batch requests', async () => {
    const http = fakeHttp();
    const e = createGeminiEmbedder({ apiKey: 'k', model: '', http });
    const vecs = await e.embed(Array.from({ length: 150 }, (_, i) => `t${i}`));
    expect(vecs).toHaveLength(150);
    expect(http.calls).toHaveLength(2); // 100 + 50
  });

  it('throws on an API error and on a count mismatch', async () => {
    const bad: HttpClient = {
      async post() {
        return { ok: false, status: 429, text: async () => 'quota', json: async () => ({}) };
      },
    };
    await expect(createGeminiEmbedder({ apiKey: 'k', model: '', http: bad }).embed(['a'])).rejects.toThrow(/429/);

    const short: HttpClient = {
      async post() {
        return { ok: true, status: 200, text: async () => '', json: async () => ({ embeddings: [] }) };
      },
    };
    await expect(createGeminiEmbedder({ apiKey: 'k', model: '', http: short }).embed(['a'])).rejects.toThrow(/vectors for/);
  });
});
