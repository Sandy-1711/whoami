// Cosine similarity + the embedding cache for the evidence set.
//
// The evidence set is tiny (<=200 units), so there is no vector DB: claim vectors
// live in a derived JSON cache at .agent/evidence-embeddings.json (gitignored,
// rebuildable) keyed by sha(claim). `embedClaims` reuses cached vectors and only
// calls the Embedder for cache misses, then persists the augmented cache — so a
// re-ingest with unchanged claims costs zero embedding calls. Dedup (Layer 3) and
// the relevance matrix (Layer 6) compare these vectors with `cosine`.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Embedder } from '../ports/embedding.js';
import { sha } from '../profile/sources.js';

// Cosine similarity in [-1, 1]; 0 when either vector is zero or lengths differ.
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface EmbeddingCache {
  // The model the vectors were produced with. A model change invalidates the
  // whole cache (dimensions/space differ), so we rebuild rather than mix spaces.
  model: string;
  vectors: Record<string, number[]>; // sha(claim) → vector
}

const CACHE_PATH = (root: string): string => join(root, '.agent', 'evidence-embeddings.json');

export async function readEmbeddingCache(root: string): Promise<EmbeddingCache | null> {
  const p = CACHE_PATH(root);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(await readFile(p, 'utf8'));
    if (!raw || typeof raw.model !== 'string' || typeof raw.vectors !== 'object') return null;
    return { model: raw.model, vectors: raw.vectors };
  } catch {
    return null;
  }
}

export async function writeEmbeddingCache(root: string, cache: EmbeddingCache): Promise<void> {
  await mkdir(join(root, '.agent'), { recursive: true });
  await writeFile(CACHE_PATH(root), JSON.stringify(cache, null, 2) + '\n');
}

// Embed claims with cache reuse: cached vectors (same model) are kept, misses are
// batched to the Embedder, and the merged cache is persisted. Returns vectors
// aligned 1:1 with the input `claims`. Duplicate claims share one embedding.
export async function embedClaims(
  root: string,
  claims: string[],
  embedder: Embedder,
): Promise<number[][]> {
  const existing = await readEmbeddingCache(root);
  // A model change means the cached space no longer matches — start fresh.
  const vectors: Record<string, number[]> =
    existing && existing.model === embedder.model ? { ...existing.vectors } : {};

  // Unique cache-miss claims, preserving first-seen order for the batch call.
  const misses: string[] = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    const key = sha(claim);
    if (vectors[key] || seen.has(key)) continue;
    seen.add(key);
    misses.push(claim);
  }

  if (misses.length) {
    const fresh = await embedder.embed(misses);
    misses.forEach((claim, i) => {
      vectors[sha(claim)] = fresh[i];
    });
    await writeEmbeddingCache(root, { model: embedder.model, vectors });
  } else if (!existing || existing.model !== embedder.model) {
    // Nothing to fetch but the on-disk cache was stale/absent — refresh it.
    await writeEmbeddingCache(root, { model: embedder.model, vectors });
  }

  return claims.map((claim) => vectors[sha(claim)]);
}
