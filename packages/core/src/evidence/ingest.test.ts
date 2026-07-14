import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IngestService } from './ingest.js';
import { readEvidence } from './store.js';
import { silentPresenter } from '../ports/logger.js';
import type { LlmProvider, LlmRequest } from '../ports/llm.js';
import type { Embedder } from '../ports/embedding.js';

const NOW = new Date('2026-07-14T00:00:00Z');

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ingest-'));
  await mkdir(join(root, 'profile'), { recursive: true });
  await writeFile(
    join(root, 'profile', 'facts.json'),
    JSON.stringify({
      experience: [{ org: 'AiRA', keywords: ['FastAPI'], highlights: ['Built the Daily Brief agent.'] }],
    }),
  );
  await writeFile(
    join(root, 'profile', 'github.json'),
    JSON.stringify({
      repos: [
        { name: 'whoami', description: 'a résumé toolkit', url: 'u', homepage: '', stars: 5, language: 'TypeScript', topics: ['cli'], archived: false, pushedAt: '2026-06-01T00:00:00Z', fork: false, readmeSize: 2500 },
        { name: 'aFork', description: '', url: 'u', homepage: '', stars: 0, language: '', topics: [], archived: false, pushedAt: '2020-01-01T00:00:00Z', fork: true, readmeSize: 0 },
      ],
      contributions: [],
    }),
  );
  return root;
}

// Routes generateJson by prompt content: gate → keep survivors; extract → 1 claim
// per repo source; merge → passthrough (not expected to fire with distinct vectors).
function provider(): LlmProvider {
  return {
    id: 'fake', label: 'Fake', model: 'm',
    async generateJson<T>(req: LlmRequest): Promise<T> {
      const p = req.prompt;
      if (p.includes('curating')) {
        return { repos: [{ name: 'whoami', keep: true, quality: 0.9, reason: 'real tool' }] } as unknown as T;
      }
      if (p.includes('Extract atomic')) {
        const m = p.match(/github · (\S+)/);
        const ref = m?.[1] ?? '';
        return { units: [{ claim: `Built ${ref}, a TypeScript CLI`, skills: ['TypeScript'], domains: ['cli'] }] } as unknown as T;
      }
      return { claim: 'merged' } as unknown as T;
    },
  };
}

// Distinct unit vectors → no accidental clustering.
function embedder(): Embedder {
  let n = 0;
  return {
    id: 'e', label: 'E', model: 'fake-embed',
    async embed(texts: string[]) {
      return texts.map(() => { const v = [n++, 1, 0]; return v; });
    },
  };
}

describe('IngestService', () => {
  it('seeds facts, gates repos, extracts, and writes evidence.json', async () => {
    const root = await tmpRoot();
    const res = await new IngestService({ root, presenter: silentPresenter }).run(
      {},
      { provider: provider(), embedder: embedder(), now: NOW },
    );

    expect(res.reposKept).toBe(1); // fork excluded by Stage A
    expect(res.seedUnits).toBe(1);
    expect(res.extractedUnits).toBe(1); // one claim from the kept repo
    expect(res.mergedUnits).toBe(2); // seed + extracted, distinct
    expect(res.relPath).toBe('profile/evidence.json');

    const store = await readEvidence(root);
    expect(store.units).toHaveLength(2);
    expect(store.units.some((u) => u.provenance[0].source === 'facts')).toBe(true);
    expect(store.units.some((u) => u.provenance[0].source === 'github')).toBe(true);
    // github unit carries the gate's quality score.
    const gh = store.units.find((u) => u.provenance[0].source === 'github')!;
    expect(gh.quality_score).toBeGreaterThan(0.7);
  });

  it('refuses to overwrite an existing store without force', async () => {
    const root = await tmpRoot();
    const svc = new IngestService({ root, presenter: silentPresenter });
    await svc.run({}, { provider: provider(), embedder: embedder(), now: NOW });
    await expect(svc.run({}, { provider: provider(), embedder: embedder(), now: NOW })).rejects.toThrow(/force/);
    await expect(svc.run({ force: true }, { provider: provider(), embedder: embedder(), now: NOW })).resolves.toBeTruthy();
  });

  it('honors curation: banned repos are excluded before the gate', async () => {
    const root = await tmpRoot();
    await writeFile(join(root, 'profile', 'curation.json'), JSON.stringify({ repos: { whoami: 'banned' } }));
    const res = await new IngestService({ root, presenter: silentPresenter }).run(
      {},
      { provider: provider(), embedder: embedder(), now: NOW },
    );
    expect(res.reposBanned).toBe(1);
    expect(res.reposKept).toBe(0);
    const store = await readEvidence(root);
    expect(store.units.every((u) => u.provenance[0].source !== 'github')).toBe(true);
  });
});
