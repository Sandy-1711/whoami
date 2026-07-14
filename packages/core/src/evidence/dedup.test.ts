import { describe, it, expect } from 'vitest';
import { clusterUnits, mergeUnits, representativeClaim, dedupeUnits } from './dedup.js';
import { makeEvidenceId, type EvidenceUnit } from './store.js';
import type { LlmProvider, LlmRequest } from '../ports/llm.js';
import type { MergeResponse } from '../prompts.js';

const unit = (over: Partial<EvidenceUnit>): EvidenceUnit => ({
  id: over.id ?? makeEvidenceId(over.claim ?? 'c'),
  claim: over.claim ?? 'c',
  skills: over.skills ?? [],
  domains: over.domains ?? [],
  provenance: over.provenance ?? [{ source: 'github', ref: 'r' }],
  quality_score: over.quality_score ?? 0.5,
  tier: over.tier ?? 'normal',
  ...over,
});

describe('clusterUnits', () => {
  it('groups vectors above the threshold and isolates the rest', () => {
    const vectors = [
      [1, 0, 0],
      [0.99, 0.01, 0], // ~parallel to [0] → same cluster
      [0, 1, 0], // orthogonal → its own cluster
    ];
    const clusters = clusterUnits(vectors, 0.9).map((c) => c.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
    expect(clusters).toEqual([[0, 1], [2]]);
  });

  it('returns singletons when nothing is similar', () => {
    expect(clusterUnits([[1, 0], [0, 1]], 0.9).map((c) => c.length).sort()).toEqual([1, 1]);
  });
});

describe('mergeUnits', () => {
  it('unions provenance/skills/domains, takes max quality, strongest tier, latest recency', () => {
    const merged = mergeUnits(
      [
        unit({ claim: 'a', skills: ['TS'], domains: ['agents'], provenance: [{ source: 'facts', ref: 'x' }], quality_score: 1, tier: 'normal', recency: '2026-01-01', impact: { metric: 'PRs', value: '12' } }),
        unit({ claim: 'b', skills: ['ts', 'Node'], domains: ['agents', 'streaming'], provenance: [{ source: 'github', ref: 'mastra' }], quality_score: 0.6, tier: 'pinned', recency: '2026-05-01' }),
      ],
      'merged claim',
    );
    expect(merged.claim).toBe('merged claim');
    expect(merged.id).toBe(makeEvidenceId('merged claim'));
    expect(merged.skills).toEqual(['TS', 'Node']); // case-insensitive union
    expect(merged.domains).toEqual(['agents', 'streaming']);
    expect(merged.provenance).toHaveLength(2);
    expect(merged.quality_score).toBe(1);
    expect(merged.tier).toBe('pinned');
    expect(merged.recency).toBe('2026-05-01');
    expect(merged.impact).toEqual({ metric: 'PRs', value: '12' }); // facts-backed impact wins
  });

  it('falls back to the first cluster claim when the merged claim is empty', () => {
    const merged = mergeUnits([unit({ claim: 'only' })], '   ');
    expect(merged.claim).toBe('only');
  });
});

describe('representativeClaim', () => {
  it('picks highest quality, tie-broken by longest text', () => {
    const rep = representativeClaim([
      unit({ claim: 'short', quality_score: 0.5 }),
      unit({ claim: 'the most specific version', quality_score: 0.5 }),
      unit({ claim: 'low', quality_score: 0.1 }),
    ]);
    expect(rep).toBe('the most specific version');
  });
});

describe('dedupeUnits', () => {
  const provider = (claim: string): LlmProvider => ({
    id: 'f', label: 'F', model: 'm',
    async generateJson<T>(_r: LlmRequest): Promise<T> {
      return { claim } as unknown as T;
    },
  });

  it('passes singletons through and LLM-merges a cluster', async () => {
    const units = [
      unit({ claim: 'built agent loop', skills: ['FastAPI'] }),
      unit({ claim: 'built an agentic orchestration loop', skills: ['asyncio'] }),
      unit({ claim: 'unrelated backend work', skills: ['Redis'] }),
    ];
    const vectors = [
      [1, 0, 0],
      [0.98, 0.02, 0],
      [0, 0, 1],
    ];
    const out = await dedupeUnits({ units, vectors, provider: provider('built an async agent orchestration loop') });
    expect(out).toHaveLength(2);
    const merged = out.find((u) => u.claim === 'built an async agent orchestration loop')!;
    expect(merged.skills.sort()).toEqual(['FastAPI', 'asyncio']);
    expect(out.some((u) => u.claim === 'unrelated backend work')).toBe(true);
  });

  it('falls back to the representative claim if the merge LLM fails', async () => {
    const failing: LlmProvider = {
      id: 'f', label: 'F', model: 'm',
      async generateJson<T>(): Promise<T> { throw new Error('quota'); },
    };
    const units = [unit({ claim: 'short', quality_score: 0.4 }), unit({ claim: 'the longer, more specific claim', quality_score: 0.4 })];
    const out = await dedupeUnits({ units, vectors: [[1, 0], [0.99, 0.01]], provider: failing });
    expect(out).toHaveLength(1);
    expect(out[0].claim).toBe('the longer, more specific claim');
  });
});
