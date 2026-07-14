import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_WEIGHTS, readWeights, tagOverlap, recencyScore, relevanceScore, buildRelevanceMatrix,
} from './relevance.js';
import type { EvidenceUnit } from './store.js';
import type { Requirement } from './requirements.js';

const NOW = new Date('2026-07-14T00:00:00Z');

const unit = (over: Partial<EvidenceUnit> = {}): EvidenceUnit => ({
  id: over.id ?? 'u', claim: over.claim ?? 'built an agent', skills: over.skills ?? ['FastAPI'],
  domains: over.domains ?? ['agents'], provenance: [{ source: 'github', ref: 'r' }],
  quality_score: over.quality_score ?? 0.8, tier: 'normal', ...over,
});

describe('tagOverlap', () => {
  it('is the fraction of unit tags named in the requirement text', () => {
    const u = unit({ skills: ['FastAPI', 'Redis'], domains: ['agents', 'auth'] });
    expect(tagOverlap(u, 'We need FastAPI and agents experience')).toBe(0.5); // 2 of 4
    expect(tagOverlap(u, 'nothing relevant')).toBe(0);
    expect(tagOverlap(unit({ skills: [], domains: [] }), 'x')).toBe(0);
  });
});

describe('recencyScore', () => {
  it('is 1 for recent work and decays with age', () => {
    expect(recencyScore('2026-06-01T00:00:00Z', NOW)).toBe(1); // <6mo
    expect(recencyScore('2020-01-01T00:00:00Z', NOW)).toBe(0); // very old
    expect(recencyScore(undefined, NOW)).toBe(0.4); // unknown → mild
  });
});

describe('relevanceScore', () => {
  const req: Requirement = { req: 'build FastAPI agents', weight: 1 };
  it('rewards semantic + tag + quality + recency and stays within [0, sum(weights)]', () => {
    const high = relevanceScore(unit({ recency: '2026-06-01T00:00:00Z' }), [1, 0, 0], req, [1, 0, 0], { weights: DEFAULT_WEIGHTS, now: NOW });
    const low = relevanceScore(unit({ skills: [], domains: [], quality_score: 0, recency: '2019-01-01' }), [0, 1, 0], req, [1, 0, 0], { weights: DEFAULT_WEIGHTS, now: NOW });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(1.0001);
    expect(low).toBeGreaterThanOrEqual(0);
  });

  it('adds the gamma-weighted rerank when provided', () => {
    const without = relevanceScore(unit(), [1, 0], req, [1, 0], { weights: DEFAULT_WEIGHTS, now: NOW });
    const withRerank = relevanceScore(unit(), [1, 0], req, [1, 0], { weights: DEFAULT_WEIGHTS, now: NOW, rerank: 1 });
    expect(withRerank - without).toBeCloseTo(DEFAULT_WEIGHTS.gamma_rerank);
  });
});

describe('buildRelevanceMatrix', () => {
  it('produces a requirement × unit matrix using per-pair rerank lookups', () => {
    const units = [unit({ id: 'a' }), unit({ id: 'b' })];
    const reqs: Requirement[] = [{ req: 'r0', weight: 1 }, { req: 'r1', weight: 0.5 }];
    const m = buildRelevanceMatrix({
      units, unitVectors: [[1, 0], [0, 1]], requirements: reqs, requirementVectors: [[1, 0], [0, 1]],
      weights: DEFAULT_WEIGHTS, now: NOW, rerank: new Map([['0:0', 1]]),
    });
    expect(m).toHaveLength(2);
    expect(m[0]).toHaveLength(2);
    expect(m[0][0]).toBeGreaterThan(m[1][0]); // req0 matches unit0's vector + rerank boost
  });
});

describe('readWeights', () => {
  it('returns defaults when the file is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weights-'));
    expect(await readWeights(root)).toEqual(DEFAULT_WEIGHTS);
  });

  it('merges a partial file over defaults and ignores non-numbers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'weights-'));
    await mkdir(join(root, 'profile'), { recursive: true });
    await writeFile(join(root, 'profile', 'weights.json'), JSON.stringify({ alpha_cosine: 0.9, beta_tag: 'nope' }));
    const w = await readWeights(root);
    expect(w.alpha_cosine).toBe(0.9);
    expect(w.beta_tag).toBe(DEFAULT_WEIGHTS.beta_tag); // invalid → default
  });
});
