import { describe, it, expect } from 'vitest';
import { buildSourceRecords, seedUnitsFromFacts } from './normalize.js';
import { makeEvidenceId } from './store.js';
import type { Facts, GithubRepo, GithubContribution, LinkedinData } from '../types.js';

const repo = (over: Partial<GithubRepo> = {}): GithubRepo => ({
  name: 'whoami', description: 'a résumé toolkit', url: 'u', homepage: 'h',
  stars: 5, language: 'TypeScript', topics: ['cli'], archived: false,
  pushedAt: '2026-06-01T00:00:00Z', fork: false, readmeSize: 2000, ...over,
});

describe('buildSourceRecords', () => {
  it('emits one record per kept repo, contribution, and LinkedIn surface', () => {
    const contributions: GithubContribution[] = [
      { repo: 'mastra-ai/mastra', url: 'u', merged: 12, open: 1, closedUnmerged: 0, stars: 25000, samplePRs: [{ number: 1, title: 'streaming', state: 'merged', url: 'p' }] },
    ];
    const linkedin = { profile: { about: 'I build agents.', experience: [{ company: 'AiRA', title: 'AI Engineer', description: 'Shipped agents.' }, { company: 'X', title: 'Y', description: '' }] } } as unknown as LinkedinData;

    const recs = buildSourceRecords({ keptRepos: [repo()], contributions, linkedin });
    const sources = recs.map((r) => r.source);
    expect(sources).toEqual(['github', 'contribution', 'linkedin', 'linkedin']); // empty-description exp dropped
    expect(recs[0].text).toContain('résumé toolkit');
    expect(recs[0].recency).toBe('2026-06-01T00:00:00Z');
    expect(recs[1].text).toContain('12 merged');
    expect(recs[1].text).toContain('streaming');
    expect(recs.find((r) => r.ref === 'linkedin/about')).toBeTruthy();
  });

  it('tolerates a null LinkedIn profile', () => {
    expect(buildSourceRecords({ keptRepos: [], contributions: [], linkedin: null })).toEqual([]);
  });
});

describe('seedUnitsFromFacts', () => {
  const facts: Facts = {
    experience: [{ org: 'AiRA', keywords: ['RAG', 'FastAPI'], highlights: ['Built the Daily Brief agent.', 'Cut token usage by 82%.'] }],
    projects: [{ name: 'Samagra', keywords: ['React Native'], highlights: ['Scaled to 10,000+ users.'] }],
    headline_metrics: ['12 merged PRs into Mastra', 'Built the Daily Brief agent.'], // last dupes an experience highlight
  };

  it('turns highlights + metrics into high-trust facts-provenance units', () => {
    const units = seedUnitsFromFacts(facts);
    const claims = units.map((u) => u.claim);
    expect(claims).toContain('Scaled to 10,000+ users.');
    const brief = units.find((u) => u.claim === 'Built the Daily Brief agent.')!;
    expect(brief.quality_score).toBe(1);
    expect(brief.provenance[0].source).toBe('facts');
    expect(brief.skills).toEqual(['RAG', 'FastAPI']);
    expect(brief.id).toBe(makeEvidenceId('Built the Daily Brief agent.'));
  });

  it('collapses a claim that appears in two sections into one unit', () => {
    const units = seedUnitsFromFacts(facts);
    const briefs = units.filter((u) => u.claim === 'Built the Daily Brief agent.');
    expect(briefs).toHaveLength(1);
  });
});
