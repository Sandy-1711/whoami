import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  makeEvidenceId,
  readEvidence,
  writeEvidence,
  readCuration,
  effectiveTier,
  curatedUnits,
  validateEvidenceStore,
  type EvidenceStore,
  type EvidenceUnit,
} from './store.js';

const unit = (over: Partial<EvidenceUnit> = {}): EvidenceUnit => ({
  id: over.id ?? makeEvidenceId(over.claim ?? 'a claim'),
  claim: over.claim ?? 'a claim',
  skills: over.skills ?? ['TypeScript'],
  domains: over.domains ?? ['agents'],
  provenance: over.provenance ?? [{ source: 'github', ref: 'whoami' }],
  quality_score: over.quality_score ?? 0.5,
  tier: over.tier ?? 'normal',
  ...over,
});

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'evidence-'));
  await mkdir(join(root, 'profile'), { recursive: true });
  return root;
}

describe('makeEvidenceId', () => {
  it('is deterministic and case/space-insensitive on the claim', () => {
    expect(makeEvidenceId('Merged 12 PRs')).toBe(makeEvidenceId('  merged 12 prs  '));
    expect(makeEvidenceId('a')).not.toBe(makeEvidenceId('b'));
    expect(makeEvidenceId('a')).toMatch(/^ev_[0-9a-f]{12}$/);
  });
});

describe('store IO', () => {
  it('returns an empty store when the file is missing', async () => {
    const root = await tmpRoot();
    expect(await readEvidence(root)).toEqual({ units: [] });
    expect(await readCuration(root)).toEqual({ repos: {} });
  });

  it('round-trips units and stamps updatedAt + a default comment', async () => {
    const root = await tmpRoot();
    const written = await writeEvidence(root, { units: [unit({ claim: 'shipped X' })] });
    expect(written.updatedAt).toBeTruthy();
    expect(written._comment).toMatch(/Canonical evidence store/);
    const back = await readEvidence(root);
    expect(back.units).toHaveLength(1);
    expect(back.units[0].claim).toBe('shipped X');
  });

  it('normalizes a hand-edited file: defaults, coerced score, derived id, dropped bad provenance', async () => {
    const root = await tmpRoot();
    await writeFile(
      join(root, 'profile', 'evidence.json'),
      JSON.stringify({
        units: [
          {
            claim: 'hand written',
            quality_score: 5, // out of range → clamped to 1
            tier: 'weird', // invalid → normal
            provenance: [{ source: 'github', ref: 'r' }, { source: 'nope', ref: 'x' }, { source: 'facts', ref: '' }],
          },
        ],
      }),
    );
    const store = await readEvidence(root);
    const u = store.units[0];
    expect(u.id).toBe(makeEvidenceId('hand written'));
    expect(u.quality_score).toBe(1);
    expect(u.tier).toBe('normal');
    expect(u.skills).toEqual([]);
    expect(u.provenance).toEqual([{ source: 'github', ref: 'r' }]);
  });

  it('reads only pinned/banned verdicts from curation.json', async () => {
    const root = await tmpRoot();
    await writeFile(
      join(root, 'profile', 'curation.json'),
      JSON.stringify({ repos: { good: 'pinned', bad: 'banned', junk: 'maybe' } }),
    );
    expect(await readCuration(root)).toEqual({ repos: { good: 'pinned', bad: 'banned' } });
  });
});

describe('effectiveTier', () => {
  const curation = { repos: { hot: 'pinned' as const, spam: 'banned' as const } };

  it('lets a banned repo win over everything', () => {
    const u = unit({ tier: 'pinned', provenance: [{ source: 'github', ref: 'spam' }] });
    expect(effectiveTier(u, curation)).toBe('banned');
  });

  it('pins a unit backed by a pinned repo', () => {
    const u = unit({ tier: 'normal', provenance: [{ source: 'contribution', ref: 'hot' }] });
    expect(effectiveTier(u, curation)).toBe('pinned');
  });

  it('respects a unit-level ban even without curation', () => {
    expect(effectiveTier(unit({ tier: 'banned' }), { repos: {} })).toBe('banned');
  });

  it('ignores curation on non-repo provenance sources', () => {
    const u = unit({ tier: 'normal', provenance: [{ source: 'linkedin', ref: 'hot' }] });
    expect(effectiveTier(u, curation)).toBe('normal');
  });
});

describe('curatedUnits', () => {
  it('drops banned, resolves tiers, and orders pinned-then-quality first', () => {
    const store: EvidenceStore = {
      units: [
        unit({ id: 'a', claim: 'a', quality_score: 0.4, tier: 'normal' }),
        unit({ id: 'b', claim: 'b', tier: 'banned' }),
        unit({ id: 'c', claim: 'c', quality_score: 0.9, tier: 'normal' }),
        unit({ id: 'd', claim: 'd', provenance: [{ source: 'github', ref: 'star' }] }),
      ],
    };
    const out = curatedUnits(store, { repos: { star: 'pinned' } });
    expect(out.map((u) => u.id)).toEqual(['d', 'c', 'a']);
    expect(out.find((u) => u.id === 'd')!.tier).toBe('pinned');
  });
});

describe('validateEvidenceStore', () => {
  it('is clean for a well-formed store', () => {
    expect(validateEvidenceStore({ units: [unit()] })).toEqual([]);
  });

  it('flags empty claims, missing provenance, and duplicate ids', () => {
    const issues = validateEvidenceStore({
      units: [
        unit({ id: 'dup', claim: '', provenance: [] }),
        unit({ id: 'dup', claim: 'ok' }),
      ],
    });
    expect(issues.join('\n')).toMatch(/empty claim/);
    expect(issues.join('\n')).toMatch(/no provenance/);
    expect(issues.join('\n')).toMatch(/duplicate id/);
  });
});

describe('writeEvidence normalization', () => {
  it('drops in-memory noise through the normalizer on write', async () => {
    const root = await tmpRoot();
    const dirty = { skills: ['  Go  ', ''], quality_score: -2 } as unknown as EvidenceUnit;
    await writeEvidence(root, { units: [{ ...unit(), ...dirty, claim: 'c' }] });
    const raw = JSON.parse(await readFile(join(root, 'profile', 'evidence.json'), 'utf8'));
    expect(raw.units[0].skills).toEqual(['Go']);
    expect(raw.units[0].quality_score).toBe(0);
  });
});
