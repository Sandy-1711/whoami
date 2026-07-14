// Dedup + merge (architecture Layer 3, second half).
//
// Claims extracted from different surfaces overlap heavily (a repo, its LinkedIn
// blurb, and a facts highlight all describe the same work). We embed every claim
// (evidence/embedding.ts), single-linkage cluster by cosine >= threshold, then
// fold each cluster into one unit: metadata is unioned deterministically and the
// claim text is merged by the LLM (falling back to the strongest representative
// if that call fails). Merged provenance keeps every source, so a corroborated
// claim stays traceable to all of them.
import type { LlmProvider } from '../ports/llm.js';
import { mergePrompt, MERGE_SCHEMA, type MergeResponse } from '../prompts.js';
import { cosine } from './embedding.js';
import {
  makeEvidenceId,
  type EvidenceImpact,
  type EvidenceProvenance,
  type EvidenceTier,
  type EvidenceUnit,
} from './store.js';

export const DEDUP_THRESHOLD = 0.9;

// Single-linkage clustering of item indices by cosine similarity. Returns groups
// of indices (singletons included), each group's members in ascending order.
export function clusterUnits(vectors: number[][], threshold = DEDUP_THRESHOLD): number[][] {
  const n = vectors.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) [x, parent[x]] = [parent[x], root]; // path compression
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cosine(vectors[i], vectors[j]) >= threshold) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const group = groups.get(r) ?? [];
    group.push(i);
    groups.set(r, group);
  }
  return [...groups.values()];
}

const TIER_RANK: Record<EvidenceTier, number> = { pinned: 2, normal: 1, banned: 0 };

// Deterministically combine a cluster's metadata onto a chosen merged claim.
// Provenance/skills/domains are unioned; quality is the max (corroboration is
// strength); tier is the strongest; impact prefers a facts-backed unit; recency
// is the latest.
export function mergeUnits(cluster: EvidenceUnit[], mergedClaim: string): EvidenceUnit {
  const claim = mergedClaim.trim() || cluster[0].claim;
  const provenance: EvidenceProvenance[] = [];
  const provKeys = new Set<string>();
  for (const u of cluster) {
    for (const p of u.provenance) {
      const k = `${p.source}:${p.ref}`;
      if (provKeys.has(k)) continue;
      provKeys.add(k);
      provenance.push(p);
    }
  }
  return {
    id: makeEvidenceId(claim),
    claim,
    skills: unionStrings(cluster.flatMap((u) => u.skills)),
    domains: unionStrings(cluster.flatMap((u) => u.domains)),
    seniority_signal: cluster.find((u) => u.seniority_signal)?.seniority_signal,
    impact: pickImpact(cluster),
    provenance,
    recency: latest(cluster.map((u) => u.recency)),
    quality_score: Math.max(...cluster.map((u) => u.quality_score)),
    tier: cluster.reduce<EvidenceTier>((best, u) => (TIER_RANK[u.tier] > TIER_RANK[best] ? u.tier : best), 'banned'),
  };
}

// The representative claim of a cluster: highest quality, tie-broken by longest
// (most specific) text. Used as the LLM-merge fallback and for singletons.
export function representativeClaim(cluster: EvidenceUnit[]): string {
  return [...cluster].sort(
    (a, b) => b.quality_score - a.quality_score || b.claim.length - a.claim.length,
  )[0].claim;
}

// Cluster + merge a full unit set. Singletons pass through untouched; multi-unit
// clusters get an LLM-merged claim (fallback: the representative) plus unioned
// metadata. `vectors` must align 1:1 with `units`.
export async function dedupeUnits(input: {
  units: EvidenceUnit[];
  vectors: number[][];
  provider: LlmProvider;
  threshold?: number;
}): Promise<EvidenceUnit[]> {
  const { units, vectors, provider } = input;
  const clusters = clusterUnits(vectors, input.threshold ?? DEDUP_THRESHOLD);
  const out: EvidenceUnit[] = [];
  for (const idx of clusters) {
    const members = idx.map((i) => units[i]);
    if (members.length === 1) {
      out.push(members[0]);
      continue;
    }
    let claim = representativeClaim(members);
    try {
      const parsed = await provider.generateJson<MergeResponse>({
        prompt: mergePrompt(members.map((m) => m.claim)),
        schema: MERGE_SCHEMA,
      });
      if (parsed?.claim?.trim()) claim = parsed.claim.trim();
    } catch {
      /* keep the representative claim */
    }
    out.push(mergeUnits(members, claim));
  }
  return out;
}

function unionStrings(arr: string[]): string[] {
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

function pickImpact(cluster: EvidenceUnit[]): EvidenceImpact | undefined {
  const factsBacked = cluster.find((u) => u.impact && u.provenance.some((p) => p.source === 'facts'));
  return (factsBacked ?? cluster.find((u) => u.impact))?.impact;
}

function latest(dates: (string | undefined)[]): string | undefined {
  const valid = dates.filter((d): d is string => !!d && !Number.isNaN(Date.parse(d)));
  if (!valid.length) return undefined;
  return valid.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}
