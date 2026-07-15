import { describe, it, expect } from 'vitest';
import { computeDrift, driftLines } from './drift.js';
import type { EvidenceUnit } from './store.js';
import type { GithubData, LinkedinData } from '../types.js';

const unit = (id: string, skills: string[], opts: Partial<EvidenceUnit> = {}): EvidenceUnit => ({
  id, claim: id, skills, domains: [], provenance: opts.provenance ?? [{ source: 'facts', ref: id }],
  quality_score: 0.6, tier: opts.tier ?? 'normal', ...opts,
});

const linkedin = (over: Partial<LinkedinData['profile']>): LinkedinData => ({
  _comment: '', scrapedAt: '', via: 'test', profileUrl: '',
  profile: { name: 'X', headline: '', experience: [], education: [], skills: [], ...over },
});

const github = (over: Partial<GithubData> & { bio?: string }): GithubData =>
  ({ _comment: '', scrapedAt: '', username: 'u', profileUrl: '', totals: { publicRepos: 0, totalStars: 0, mergedPRs: 0, externalRepos: 0 }, repos: [], contributions: [], ...over } as GithubData);

describe('computeDrift — LinkedIn', () => {
  it('flags evidenced skills missing from the LinkedIn skills list', () => {
    const units = [unit('a', ['TypeScript', 'Mastra']), unit('b', ['Mastra'])];
    const d = computeDrift({ units, linkedin: linkedin({ skills: ['TypeScript'] }), github: null });
    const missing = d.filter((i) => i.field === 'skills');
    expect(missing.map((i) => i.fix)).toContain('Mastra');
    expect(missing.every((i) => i.fix !== 'TypeScript')).toBe(true); // already listed
  });

  it('matches skills case-insensitively', () => {
    const d = computeDrift({ units: [unit('a', ['TypeScript'])], linkedin: linkedin({ skills: ['typescript'] }), github: null });
    expect(d.filter((i) => i.field === 'skills')).toHaveLength(0);
  });

  it('flags strong proof not surfaced in the headline/about prose', () => {
    const units = [unit('a', ['Mastra'], { tier: 'pinned' }), unit('b', ['Mastra'])];
    const d = computeDrift({ units, linkedin: linkedin({ headline: 'Software Engineer', about: 'I build things.', skills: ['Mastra'] }), github: null });
    expect(d.some((i) => i.field === 'headline' && i.kind === 'unsurfaced' && i.fix === 'Mastra')).toBe(true);
  });

  it('does not flag a skill as unsurfaced when it appears in the About text', () => {
    const units = [unit('a', ['Mastra'], { tier: 'pinned' }), unit('b', ['Mastra'])];
    const d = computeDrift({ units, linkedin: linkedin({ headline: 'Engineer', about: 'I ship Mastra agents.', skills: ['Mastra'] }), github: null });
    expect(d.some((i) => i.field === 'headline')).toBe(false);
  });

  it('flags an empty About', () => {
    const d = computeDrift({ units: [unit('a', ['x'])], linkedin: linkedin({ about: '' }), github: null });
    expect(d.some((i) => i.field === 'about' && i.kind === 'empty')).toBe(true);
  });

  it('weak (single, unpinned) skills are not treated as headline-worthy', () => {
    const d = computeDrift({ units: [unit('a', ['Rust'])], linkedin: linkedin({ headline: 'Engineer', about: 'text', skills: ['Rust'] }), github: null });
    expect(d.some((i) => i.field === 'headline')).toBe(false);
  });
});

describe('computeDrift — GitHub', () => {
  it('flags an empty bio', () => {
    const d = computeDrift({ units: [unit('a', ['x'])], linkedin: null, github: github({ bio: '' }) });
    expect(d.some((i) => i.surface === 'github' && i.field === 'bio' && i.kind === 'empty')).toBe(true);
  });

  it('flags a bio that mentions no top skill', () => {
    const units = [unit('a', ['Mastra'], { tier: 'pinned' })];
    const d = computeDrift({ units, linkedin: null, github: github({ bio: 'I like coffee.' }) });
    expect(d.some((i) => i.field === 'bio' && i.kind === 'unsurfaced')).toBe(true);
  });

  it('flags referenced repos with no description', () => {
    const units = [unit('a', ['x'], { provenance: [{ source: 'github', ref: 'EvidenceRepo' }] })];
    const gh = github({ repos: [
      { name: 'EvidenceRepo', description: '', url: '', homepage: '', stars: 1, language: 'TS', topics: [], archived: false, pushedAt: '', fork: false, readmeSize: 100 },
      { name: 'Unreferenced', description: '', url: '', homepage: '', stars: 0, language: 'TS', topics: [], archived: false, pushedAt: '', fork: false, readmeSize: 0 },
    ] });
    const d = computeDrift({ units, linkedin: null, github: gh });
    const repoItems = d.filter((i) => i.field.startsWith('repo:'));
    expect(repoItems.map((i) => i.fix)).toEqual(['EvidenceRepo']); // only the referenced, description-less repo
  });

  it('ignores forks and archived repos for description drift', () => {
    const units = [unit('a', ['x'], { provenance: [{ source: 'github', ref: 'Forked' }] })];
    const gh = github({ repos: [
      { name: 'Forked', description: '', url: '', homepage: '', stars: 0, language: 'TS', topics: [], archived: false, pushedAt: '', fork: true, readmeSize: 0 },
    ] });
    const d = computeDrift({ units, linkedin: null, github: gh });
    expect(d.some((i) => i.field.startsWith('repo:'))).toBe(false);
  });
});

describe('driftLines', () => {
  it('renders one detail line per item', () => {
    const d = computeDrift({ units: [unit('a', ['x'])], linkedin: linkedin({ about: '' }), github: github({ bio: '' }) });
    expect(driftLines(d)).toEqual(d.map((i) => i.detail));
  });
});
