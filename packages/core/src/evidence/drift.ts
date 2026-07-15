// Deterministic drift detector (architecture Layer 4 / 8).
//
// The evidence store is the canonical account of what's TRUE and worth showing.
// The scraped LinkedIn/GitHub JSON is what's CURRENTLY LIVE on the public
// surfaces. `computeDrift` diffs the two and emits a precise, structured
// stale/missing list — the "exact stale-item report" the architecture asks for.
// It is pure + deterministic (no LLM): every item points at a concrete surface
// field and the concrete fix. The EnhanceService layers LLM-written copy on top,
// but the drift report itself is verifiable and stable across runs.
import type { GithubData, LinkedinData } from '../types.js';
import type { EvidenceUnit } from './store.js';

export interface DriftItem {
  surface: 'linkedin' | 'github';
  // 'skills' | 'headline' | 'about' | 'bio' | `repo:${name}`
  field: string;
  // 'empty' = the surface field is blank; 'missing' = evidenced item absent from
  // a list; 'unsurfaced' = strong proof not reflected in the prose.
  kind: 'empty' | 'missing' | 'unsurfaced';
  detail: string;      // one human-readable line
  fix?: string;        // the concrete thing to add (skill, keyword, description)
}

export interface DriftInput {
  units: EvidenceUnit[];       // curated units (banned already dropped)
  linkedin: LinkedinData | null;
  github: GithubData | null;
  // A skill must appear in at least this many units to count as "evidenced".
  minSkillSupport?: number;    // default 1
  // Caps to keep the report actionable rather than a flood.
  maxSkills?: number;          // default 12
  maxUnsurfaced?: number;      // default 5
  maxRepos?: number;           // default 8
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

interface SkillStat {
  display: string;   // first-seen original casing
  count: number;     // units mentioning it
  pinned: number;    // pinned units mentioning it (stronger signal)
}

// Tally the skills the evidence store backs, with their support + how many
// pinned units carry them (pinned = the user forced this proof forward).
function evidencedSkills(units: EvidenceUnit[]): Map<string, SkillStat> {
  const stats = new Map<string, SkillStat>();
  for (const u of units) {
    const seen = new Set<string>(); // count a skill once per unit
    for (const raw of u.skills) {
      const key = norm(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const s = stats.get(key) ?? { display: raw.trim(), count: 0, pinned: 0 };
      s.count += 1;
      if (u.tier === 'pinned') s.pinned += 1;
      stats.set(key, s);
    }
  }
  return stats;
}

// Strongest evidenced skills first: pinned support, then raw support, then name
// for a stable order.
function rankedSkills(stats: Map<string, SkillStat>): { key: string; stat: SkillStat }[] {
  return [...stats.entries()]
    .map(([key, stat]) => ({ key, stat }))
    .sort((a, b) => b.stat.pinned - a.stat.pinned || b.stat.count - a.stat.count || a.key.localeCompare(b.key));
}

export function computeDrift(input: DriftInput): DriftItem[] {
  const {
    units, linkedin, github,
    minSkillSupport = 1, maxSkills = 12, maxUnsurfaced = 5, maxRepos = 8,
  } = input;
  const items: DriftItem[] = [];

  const stats = evidencedSkills(units);
  const ranked = rankedSkills(stats).filter((r) => r.stat.count >= minSkillSupport);

  // ---- LinkedIn ------------------------------------------------------------
  const li = linkedin?.profile ?? null;
  if (li) {
    const liveSkills = new Set((li.skills ?? []).map(norm));

    // Skills the store backs but LinkedIn's skills section omits.
    let added = 0;
    for (const { key, stat } of ranked) {
      if (added >= maxSkills) break;
      if (liveSkills.has(key)) continue;
      items.push({
        surface: 'linkedin', field: 'skills', kind: 'missing',
        detail: `LinkedIn skills omit "${stat.display}" (${stat.count} evidence unit${stat.count === 1 ? '' : 's'}${stat.pinned ? `, ${stat.pinned} pinned` : ''}).`,
        fix: stat.display,
      });
      added += 1;
    }

    // Strong proof not reflected anywhere in the headline/about prose.
    const prose = `${norm(li.headline ?? '')} ${norm(li.about ?? '')}`;
    let unsurfaced = 0;
    for (const { key, stat } of ranked) {
      if (unsurfaced >= maxUnsurfaced) break;
      // Only flag well-supported skills as "should be in the headline".
      if (stat.count < 2 && stat.pinned === 0) continue;
      if (prose.includes(key)) continue;
      items.push({
        surface: 'linkedin', field: 'headline', kind: 'unsurfaced',
        detail: `Headline/About don't mention "${stat.display}" despite strong evidence.`,
        fix: stat.display,
      });
      unsurfaced += 1;
    }

    if (!norm(li.about ?? '')) {
      items.push({ surface: 'linkedin', field: 'about', kind: 'empty', detail: 'LinkedIn About is empty — add a metric-led summary.' });
    }
  }

  // ---- GitHub --------------------------------------------------------------
  if (github) {
    const bio = norm((github as unknown as { bio?: string }).bio ?? '');
    if (!bio) {
      items.push({ surface: 'github', field: 'bio', kind: 'empty', detail: 'GitHub bio is empty — add a one-line focus + strongest proof.' });
    } else {
      const top = ranked.slice(0, 6);
      if (top.length && !top.some((r) => bio.includes(r.key))) {
        items.push({ surface: 'github', field: 'bio', kind: 'unsurfaced', detail: `GitHub bio doesn't mention any top skill (${top.slice(0, 3).map((r) => r.stat.display).join(', ')}).` });
      }
    }

    // Repos the evidence store references but which ship no description on GitHub.
    const referenced = new Set<string>();
    for (const u of units) {
      for (const p of u.provenance) {
        if (p.source === 'github' || p.source === 'contribution') referenced.add(norm(p.ref));
      }
    }
    let repoItems = 0;
    for (const repo of github.repos ?? []) {
      if (repoItems >= maxRepos) break;
      if (repo.fork || repo.archived) continue;
      if (!referenced.has(norm(repo.name))) continue;
      if ((repo.description ?? '').trim()) continue;
      items.push({
        surface: 'github', field: `repo:${repo.name}`, kind: 'missing',
        detail: `Repo "${repo.name}" has evidence but no GitHub description.`,
        fix: repo.name,
      });
      repoItems += 1;
    }
  }

  return items;
}

// Compact one-line renderings for a report/tool payload.
export function driftLines(items: DriftItem[]): string[] {
  return items.map((i) => i.detail);
}
