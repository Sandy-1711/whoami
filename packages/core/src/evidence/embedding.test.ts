import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cosine, embedClaims, readEmbeddingCache } from './embedding.js';
import type { Embedder } from '../ports/embedding.js';

const tmpRoot = () => mkdtemp(join(tmpdir(), 'embed-'));

// A deterministic fake embedder that records how many texts it was asked to embed.
function fakeEmbedder(model = 'fake-embed'): Embedder & { calls: string[][]; total: number } {
  const calls: string[][] = [];
  return {
    id: 'fake',
    label: 'Fake',
    model,
    calls,
    get total() {
      return calls.reduce((n, c) => n + c.length, 0);
    },
    async embed(texts: string[]) {
      calls.push(texts);
      // A stable 3-d vector per text so cache hits are verifiable.
      return texts.map((t) => [t.length, t.charCodeAt(0) || 0, 1]);
    },
  };
}

describe('cosine', () => {
  it('is 1 for identical direction and 0 for orthogonal', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it('is 0 on length mismatch, empty, or zero vectors', () => {
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('embedClaims', () => {
  it('embeds each unique claim once and returns vectors aligned to input', async () => {
    const root = await tmpRoot();
    const e = fakeEmbedder();
    const vecs = await embedClaims(root, ['alpha', 'beta', 'alpha'], e);
    expect(vecs).toHaveLength(3);
    expect(vecs[0]).toEqual(vecs[2]); // duplicate claim → same vector
    expect(e.total).toBe(2); // 'alpha' embedded once, not twice
    expect(existsSync(join(root, '.agent', 'evidence-embeddings.json'))).toBe(true);
  });

  it('reuses the persisted cache on a second call (no new embed work)', async () => {
    const root = await tmpRoot();
    await embedClaims(root, ['alpha', 'beta'], fakeEmbedder());
    const e2 = fakeEmbedder();
    const vecs = await embedClaims(root, ['beta', 'alpha', 'gamma'], e2);
    expect(vecs).toHaveLength(3);
    expect(e2.calls.flat()).toEqual(['gamma']); // only the new claim hit the embedder
  });

  it('discards the cache when the embedding model changes', async () => {
    const root = await tmpRoot();
    await embedClaims(root, ['alpha'], fakeEmbedder('model-a'));
    const e2 = fakeEmbedder('model-b');
    await embedClaims(root, ['alpha'], e2);
    expect(e2.calls.flat()).toEqual(['alpha']); // re-embedded under the new model
    const cache = await readEmbeddingCache(root);
    expect(cache!.model).toBe('model-b');
  });

  it('persists model + vectors in the cache file', async () => {
    const root = await tmpRoot();
    await embedClaims(root, ['alpha'], fakeEmbedder('m1'));
    const raw = JSON.parse(await readFile(join(root, '.agent', 'evidence-embeddings.json'), 'utf8'));
    expect(raw.model).toBe('m1');
    expect(Object.keys(raw.vectors)).toHaveLength(1);
  });
});
