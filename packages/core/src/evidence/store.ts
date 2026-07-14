// The evidence store — Layers 1–3 of resume-system-architecture.md.
//
// `profile/evidence.json` is the canonical, committed, human-editable base of
// atomic proof units. Each `EvidenceUnit` is one grounded claim ("merged 12 PRs
// into Mastra core") with its skills/domains, an optional quantified impact, the
// sources that back it (provenance), a recency stamp, a quality score from the
// gate, and a curation tier. Later layers embed, score, and select units against
// a JD's requirement graph — but every one of them starts from this file.
//
// `profile/curation.json` holds repo-level tier overrides the user maintains by
// hand: pin a repo to force its units in, ban one to keep its noise out. Curation
// is applied on top of the per-unit tier via `effectiveTier` — bans always win,
// so a banned repo (or unit) can never leak into a résumé.
//
// This module is pure store IO + tier resolution. No LLM, no embeddings, no
// network — those live in the sibling modules (embedding, gate, extract, ingest).
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ---- schema ----------------------------------------------------------------

export const EVIDENCE_TIERS = ['pinned', 'normal', 'banned'] as const;
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

// Where a unit's proof comes from. `github`/`contribution` refs are repo names
// (so curation.json can key on them); `resume`/`facts` refs point at the fact
// base; `linkedin` refs at the scraped profile.
export const EVIDENCE_SOURCES = ['github', 'contribution', 'linkedin', 'facts', 'resume'] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export interface EvidenceProvenance {
  source: EvidenceSource;
  // A pointer into that source: a repo name, a PR url, a facts highlight, a
  // resume section — whatever lets a human re-verify the claim.
  ref: string;
}

// A quantified outcome, kept verbatim so the grounded writer (Layer 6) can check
// that any metric it prints appears here unchanged.
export interface EvidenceImpact {
  metric: string; // what was measured, e.g. "merged PRs"
  value: string;  // the figure as written, e.g. "12"
  scope?: string; // context, e.g. "into Mastra core"
}

export interface EvidenceUnit {
  id: string;
  claim: string;
  skills: string[];
  domains: string[];
  seniority_signal?: string;
  impact?: EvidenceImpact;
  provenance: EvidenceProvenance[];
  recency?: string;      // ISO date of the most recent supporting activity
  quality_score: number; // 0..1 from the quality gate
  tier: EvidenceTier;
}

export interface EvidenceStore {
  _comment?: string;
  updatedAt?: string;
  units: EvidenceUnit[];
}

// Repo-level tier overrides, maintained by hand in profile/curation.json.
export interface Curation {
  repos: Record<string, 'pinned' | 'banned'>;
}

// ---- paths -----------------------------------------------------------------

const EVIDENCE = (root: string): string => join(root, 'profile', 'evidence.json');
const CURATION = (root: string): string => join(root, 'profile', 'curation.json');

const STORE_COMMENT =
  'Canonical evidence store (see resume-system-architecture.md, Layers 1-3). ' +
  'Human-editable: each unit is one grounded claim; set tier to pinned/banned to ' +
  'force a unit in or out. Repo-level overrides live in curation.json.';

// ---- id --------------------------------------------------------------------

// Deterministic id from the claim text, so the same claim ingested twice keeps
// the same id (ingest dedup relies on this alongside cosine clustering).
export function makeEvidenceId(claim: string): string {
  const h = createHash('sha256').update(claim.trim().toLowerCase()).digest('hex').slice(0, 12);
  return `ev_${h}`;
}

// ---- store IO --------------------------------------------------------------

// Read + normalize the store, tolerating a hand-edited file: missing arrays,
// omitted tiers, and absent scores are coerced to safe defaults rather than
// throwing. Use `validateEvidenceStore` to surface issues to the user.
export async function readEvidence(root: string): Promise<EvidenceStore> {
  const p = EVIDENCE(root);
  if (!existsSync(p)) return { units: [] };
  try {
    const raw = JSON.parse(await readFile(p, 'utf8'));
    const units = Array.isArray(raw?.units) ? raw.units.map(normalizeUnit) : [];
    return { _comment: raw?._comment, updatedAt: raw?.updatedAt, units };
  } catch {
    return { units: [] };
  }
}

export async function writeEvidence(root: string, store: EvidenceStore): Promise<EvidenceStore> {
  const payload: EvidenceStore = {
    _comment: store._comment || STORE_COMMENT,
    updatedAt: new Date().toISOString(),
    units: store.units.map(normalizeUnit),
  };
  await writeFile(EVIDENCE(root), JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

export async function readCuration(root: string): Promise<Curation> {
  const p = CURATION(root);
  if (!existsSync(p)) return { repos: {} };
  try {
    const raw = JSON.parse(await readFile(p, 'utf8'));
    const repos: Record<string, 'pinned' | 'banned'> = {};
    for (const [name, verdict] of Object.entries(raw?.repos ?? {})) {
      if (verdict === 'pinned' || verdict === 'banned') repos[name] = verdict;
    }
    return { repos };
  } catch {
    return { repos: {} };
  }
}

// Coerce a possibly-partial, hand-edited unit into the full shape with safe
// defaults. Never throws — validation is a separate, explicit step.
function normalizeUnit(input: unknown): EvidenceUnit {
  const u = (input ?? {}) as Partial<EvidenceUnit> & Record<string, unknown>;
  const claim = String(u.claim ?? '').trim();
  return {
    id: (u.id ? String(u.id) : '') || makeEvidenceId(claim),
    claim,
    skills: toStringArray(u.skills),
    domains: toStringArray(u.domains),
    seniority_signal: u.seniority_signal ? String(u.seniority_signal) : undefined,
    impact: normalizeImpact(u.impact),
    provenance: normalizeProvenance(u.provenance),
    recency: u.recency ? String(u.recency) : undefined,
    quality_score: clampScore(u.quality_score),
    tier: EVIDENCE_TIERS.includes(u.tier as EvidenceTier) ? (u.tier as EvidenceTier) : 'normal',
  };
}

function normalizeImpact(i: unknown): EvidenceImpact | undefined {
  if (!i || typeof i !== 'object') return undefined;
  const o = i as Record<string, unknown>;
  const metric = String(o.metric ?? '').trim();
  const value = String(o.value ?? '').trim();
  if (!metric && !value) return undefined;
  const scope = o.scope ? String(o.scope).trim() : undefined;
  return scope ? { metric, value, scope } : { metric, value };
}

function normalizeProvenance(p: unknown): EvidenceProvenance[] {
  if (!Array.isArray(p)) return [];
  return p
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { source: o.source as EvidenceSource, ref: String(o.ref ?? '').trim() };
    })
    .filter((x) => EVIDENCE_SOURCES.includes(x.source) && x.ref.length > 0);
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

function clampScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// ---- tier + curation -------------------------------------------------------

const TIER_RANK: Record<EvidenceTier, number> = { pinned: 0, normal: 1, banned: 2 };

// Resolve a unit's effective tier under repo-level curation. Bans always win
// (a banned repo or a unit flagged banned can never surface); otherwise a pin
// on any backing repo — or on the unit itself — elevates it.
export function effectiveTier(unit: EvidenceUnit, curation: Curation): EvidenceTier {
  let pinned = unit.tier === 'pinned';
  let banned = unit.tier === 'banned';
  for (const p of unit.provenance) {
    if (p.source !== 'github' && p.source !== 'contribution') continue;
    const verdict = curation.repos[p.ref];
    if (verdict === 'banned') banned = true;
    else if (verdict === 'pinned') pinned = true;
  }
  if (banned) return 'banned';
  return pinned ? 'pinned' : 'normal';
}

// Apply curation, drop banned units, and return the survivors with their tier
// resolved — pinned first. This is the set later layers score and select over.
export function curatedUnits(store: EvidenceStore, curation: Curation): EvidenceUnit[] {
  return store.units
    .map((u) => ({ ...u, tier: effectiveTier(u, curation) }))
    .filter((u) => u.tier !== 'banned')
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.quality_score - a.quality_score);
}

// ---- validation ------------------------------------------------------------

// Structural checks a hand-edited store should pass before ingest/tailor trusts
// it. Returns human-readable issues (empty = clean); it never throws so callers
// can warn-and-continue.
export function validateEvidenceStore(store: EvidenceStore): string[] {
  const issues: string[] = [];
  const seen = new Map<string, number>();
  store.units.forEach((u, i) => {
    const at = `unit[${i}]${u.id ? ` (${u.id})` : ''}`;
    if (!u.id) issues.push(`${at}: missing id.`);
    if (!u.claim) issues.push(`${at}: empty claim.`);
    if (!u.provenance.length) issues.push(`${at}: no provenance — every claim needs a source.`);
    if (!EVIDENCE_TIERS.includes(u.tier)) issues.push(`${at}: invalid tier "${u.tier}".`);
    if (u.quality_score < 0 || u.quality_score > 1) issues.push(`${at}: quality_score ${u.quality_score} out of range 0..1.`);
    if (u.id) {
      const prev = seen.get(u.id);
      if (prev !== undefined) issues.push(`${at}: duplicate id, also at unit[${prev}].`);
      else seen.set(u.id, i);
    }
  });
  return issues;
}
