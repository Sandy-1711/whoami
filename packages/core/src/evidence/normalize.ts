// Source normalizer (architecture Layer 1, in-memory).
//
// The scrapes ARE the raw layer — there are no new persisted raw files. This
// module turns the existing github.json / linkedin.json / facts.json into two
// things ingest consumes:
//   1. SourceRecords — chunks of raw text to hand the LLM extractor, one per
//      kept repo, external contribution, and LinkedIn surface.
//   2. Seed units — the fact base's curated highlights become EvidenceUnits
//      directly (no LLM), the highest-trust starting point. This is the doc's
//      "hand-write ~15 units first" step, satisfied by the already-verified
//      facts.json, with the chat review pass replacing the manual write.
import type { Facts, GithubContribution, GithubRepo, LinkedinData } from '../types.js';
import { makeEvidenceId, type EvidenceSource, type EvidenceUnit } from './store.js';

// A chunk of raw material to extract evidence units from.
export interface SourceRecord {
  source: EvidenceSource;
  ref: string;    // repo name, 'linkedin/about', … — a re-verifiable pointer
  title: string;  // human label for progress/reports
  text: string;   // the raw content the extractor reads
  recency?: string; // ISO date of the underlying activity, when known
}

// Build extraction inputs from the gated repos, external contributions, and the
// LinkedIn profile. Facts highlights are handled separately (seedUnitsFromFacts).
export function buildSourceRecords(input: {
  keptRepos: GithubRepo[];
  contributions: GithubContribution[];
  linkedin: LinkedinData | null;
}): SourceRecord[] {
  const records: SourceRecord[] = [];

  for (const r of input.keptRepos) {
    const parts = [
      r.description && `Description: ${r.description}`,
      r.language && `Primary language: ${r.language}`,
      r.topics?.length && `Topics: ${r.topics.join(', ')}`,
      r.homepage && `Homepage: ${r.homepage}`,
      `Stars: ${r.stars}`,
    ].filter(Boolean);
    records.push({
      source: 'github',
      ref: r.name,
      title: `repo ${r.name}`,
      text: `Repository "${r.name}".\n${parts.join('\n')}`,
      recency: r.pushedAt,
    });
  }

  for (const c of input.contributions) {
    const samples = (c.samplePRs || []).map((p) => `#${p.number} ${p.title} (${p.state})`).join('; ');
    records.push({
      source: 'contribution',
      ref: c.repo,
      title: `contributions to ${c.repo}`,
      text: `Open-source contributions to ${c.repo}${c.stars ? ` (${c.stars} stars)` : ''}: ${c.merged} merged, ${c.open} open, ${c.closedUnmerged} closed-unmerged pull requests.${samples ? ` Sample PRs: ${samples}.` : ''}`,
    });
  }

  const li = input.linkedin?.profile;
  if (li?.about?.trim()) {
    records.push({ source: 'linkedin', ref: 'linkedin/about', title: 'LinkedIn about', text: li.about.trim() });
  }
  for (const exp of li?.experience ?? []) {
    if (!exp.description?.trim()) continue;
    records.push({
      source: 'linkedin',
      ref: `linkedin/${exp.company}`,
      title: `LinkedIn ${exp.company}`,
      text: `${exp.title} at ${exp.company}${exp.dates ? ` (${exp.dates})` : ''}: ${exp.description.trim()}`,
      recency: undefined,
    });
  }

  return records;
}

// Turn the fact base's verified highlights + headline metrics into seed units.
// These carry the highest trust (quality 1.0, provenance 'facts') and are the
// spine dedup/merge later fold the extracted units into.
export function seedUnitsFromFacts(facts: Facts): EvidenceUnit[] {
  const units: EvidenceUnit[] = [];
  const push = (claim: string, ref: string, skills: string[]): void => {
    const c = claim.trim();
    if (!c) return;
    units.push({
      id: makeEvidenceId(c),
      claim: c,
      skills: dedupeStrings(skills),
      domains: [],
      provenance: [{ source: 'facts', ref }],
      quality_score: 1,
      tier: 'normal',
    });
  };

  for (const e of facts.experience ?? []) {
    const ref = `experience/${e.org ?? e.role ?? 'role'}`;
    for (const h of e.highlights ?? []) push(h, ref, e.keywords ?? []);
  }
  for (const p of facts.projects ?? []) {
    const ref = `projects/${p.name ?? p.role ?? 'project'}`;
    for (const h of p.highlights ?? []) push(h, ref, p.keywords ?? []);
  }
  for (const m of facts.headline_metrics ?? []) push(m, 'headline_metrics', []);

  // Collapse exact-duplicate seeds (same claim → same id).
  const byId = new Map<string, EvidenceUnit>();
  for (const u of units) {
    const existing = byId.get(u.id);
    if (existing) existing.skills = dedupeStrings([...existing.skills, ...u.skills]);
    else byId.set(u.id, u);
  }
  return [...byId.values()];
}

function dedupeStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const v = s.trim();
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}
