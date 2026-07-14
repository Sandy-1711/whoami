import { describe, it, expect } from 'vitest';
import { scoreRepo, heuristicGate, runQualityGate, GATE_THRESHOLD } from './gate.js';
import type { GithubRepo } from '../types.js';
import type { LlmProvider, LlmRequest } from '../ports/llm.js';
import type { GateResponse } from '../prompts.js';

const NOW = new Date('2026-07-14T00:00:00Z');

const repo = (over: Partial<GithubRepo> = {}): GithubRepo => ({
  name: over.name ?? 'proj',
  description: over.description ?? 'a real tool',
  url: 'u',
  homepage: '',
  stars: over.stars ?? 5,
  language: over.language ?? 'TypeScript',
  topics: over.topics ?? ['cli', 'agents'],
  archived: over.archived ?? false,
  pushedAt: over.pushedAt ?? '2026-06-01T00:00:00Z', // recent
  fork: over.fork ?? false,
  readmeSize: over.readmeSize ?? 2500,
  ...over,
});

// A provider that returns a canned gate judgement (or throws).
function fakeProvider(res: GateResponse | Error): LlmProvider {
  return {
    id: 'fake',
    label: 'Fake',
    model: 'm',
    async generateJson<T>(_req: LlmRequest): Promise<T> {
      if (res instanceof Error) throw res;
      return res as unknown as T;
    },
  };
}

describe('scoreRepo (Stage A)', () => {
  it('scores a substantive, described, recent repo high and survives it', () => {
    const q = scoreRepo(repo(), NOW);
    expect(q.score).toBeGreaterThan(0.7);
    expect(q.survives).toBe(true);
  });

  it('never survives a fork and penalizes its score heavily', () => {
    const q = scoreRepo(repo({ fork: true }), NOW);
    expect(q.survives).toBe(false);
    expect(q.reasons).toContain('fork');
    expect(q.score).toBeLessThan(GATE_THRESHOLD);
  });

  it('drops a thin, undescribed, stale repo', () => {
    const q = scoreRepo(
      repo({ description: '', readmeSize: 0, stars: 0, topics: [], pushedAt: '2023-01-01T00:00:00Z' }),
      NOW,
    );
    expect(q.survives).toBe(false);
    expect(q.reasons).toEqual(expect.arrayContaining(['no description', 'thin or missing README']));
    expect(q.reasons.some((r) => r.startsWith('stale'))).toBe(true);
  });

  it('penalizes archived repos', () => {
    const live = scoreRepo(repo(), NOW).score;
    const archived = scoreRepo(repo({ archived: true }), NOW);
    expect(archived.score).toBeLessThan(live);
    expect(archived.reasons).toContain('archived');
  });
});

describe('heuristicGate', () => {
  it('partitions survivors from rejected and records every score', () => {
    const r = heuristicGate([repo({ name: 'good' }), repo({ name: 'aFork', fork: true })], NOW);
    expect(r.survivors.map((x) => x.name)).toEqual(['good']);
    expect(r.rejected.map((x) => x.name)).toEqual(['aFork']);
    expect(Object.keys(r.scores).sort()).toEqual(['aFork', 'good']);
  });
});

describe('runQualityGate (Stage A + LLM judge)', () => {
  it('only judges Stage-A survivors and honors the judge keep/drop', async () => {
    const provider = fakeProvider({
      repos: [{ name: 'good', keep: true, quality: 0.9, reason: 'real tool' }],
    });
    const res = await runQualityGate([repo({ name: 'good' }), repo({ name: 'aFork', fork: true })], provider, NOW);
    expect(res.kept.map((k) => k.repo.name)).toEqual(['good']);
    expect(res.rejected.map((r) => r.name)).toEqual(['aFork']); // fork never reached the judge
    expect(res.kept[0].quality).toBeGreaterThan(0.7); // blend of heuristic + 0.9
  });

  it('drops a survivor the judge rejects', async () => {
    const provider = fakeProvider({ repos: [{ name: 'good', keep: false, quality: 0.1, reason: 'tutorial' }] });
    const res = await runQualityGate([repo({ name: 'good' })], provider, NOW);
    expect(res.kept).toHaveLength(0);
    expect(res.dropped[0].reason).toBe('tutorial');
  });

  it('falls back to the heuristic verdict when the LLM judge fails', async () => {
    const res = await runQualityGate([repo({ name: 'good' })], fakeProvider(new Error('quota')), NOW);
    expect(res.kept.map((k) => k.repo.name)).toEqual(['good']);
    expect(res.kept[0].reason).not.toBe('');
  });

  it('skips the LLM entirely when nothing survives Stage A', async () => {
    let called = false;
    const provider: LlmProvider = {
      id: 'x', label: 'x', model: 'm',
      async generateJson<T>() { called = true; return {} as T; },
    };
    const res = await runQualityGate([repo({ fork: true })], provider, NOW);
    expect(called).toBe(false);
    expect(res.kept).toHaveLength(0);
  });
});
