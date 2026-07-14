// Relevance matrix (architecture Layer 6, first half).
//
// rel(e, r) scores how well evidence unit e satisfies requirement r, blending:
//   α·cosine(embeddings)  — semantic match of claim ↔ requirement
//   β·tagOverlap          — unit skills/domains named in the requirement text
//   γ·llmRerank           — optional LLM pairwise score (flag-gated, injected)
//   δ·quality             — the unit's gate quality
//   ε·recency             — how recent the supporting work is
// Weights live in committed profile/weights.json so tuning is reviewable. This
// module is pure: embeddings/rerank scores are passed in, never computed here.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cosine } from './embedding.js';
import type { EvidenceUnit } from './store.js';
import type { Requirement } from './requirements.js';

export interface Weights {
  alpha_cosine: number;
  beta_tag: number;
  gamma_rerank: number;
  delta_quality: number;
  epsilon_recency: number;
  // Redundancy penalty used by the coverage selector (Layer 6, second half).
  lambda_redundancy: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  alpha_cosine: 0.4,
  beta_tag: 0.2,
  gamma_rerank: 0.15,
  delta_quality: 0.15,
  epsilon_recency: 0.1,
  lambda_redundancy: 0.5,
};

const MONTH_MS = 1000 * 60 * 60 * 24 * 30;

// Read profile/weights.json, merged over defaults so a partial/absent file is
// safe. Unknown keys are ignored; numeric values only.
export async function readWeights(root: string): Promise<Weights> {
  const p = join(root, 'profile', 'weights.json');
  if (!existsSync(p)) return { ...DEFAULT_WEIGHTS };
  try {
    const raw = JSON.parse(await readFile(p, 'utf8'));
    const out = { ...DEFAULT_WEIGHTS };
    for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]) {
      if (typeof raw?.[k] === 'number' && Number.isFinite(raw[k])) out[k] = raw[k];
    }
    return out;
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

// Fraction of a unit's tags (skills + domains) that appear in the requirement
// text — a cheap lexical signal complementing the embedding cosine. 0..1.
export function tagOverlap(unit: EvidenceUnit, requirementText: string): number {
  const tags = [...unit.skills, ...unit.domains];
  if (!tags.length) return 0;
  const hay = requirementText.toLowerCase();
  const hit = tags.filter((t) => t.trim() && hay.includes(t.toLowerCase())).length;
  return hit / tags.length;
}

// How recent the unit's supporting work is: 1 for <6 months, decaying linearly to
// 0 by ~36 months. Undefined recency is treated as mildly stale (0.4).
export function recencyScore(recency: string | undefined, now: Date = new Date()): number {
  if (!recency || Number.isNaN(Date.parse(recency))) return 0.4;
  const months = Math.max(0, (now.getTime() - Date.parse(recency)) / MONTH_MS);
  return Math.min(1, Math.max(0, 1 - Math.max(0, months - 6) / 30));
}

export interface RelevanceContext {
  weights: Weights;
  now?: Date;
  // Optional LLM rerank score in [0,1] for this (requirement, unit) pair.
  rerank?: number;
}

// rel(e, r) for one pair. cosine is mapped from [-1,1] to [0,1] via max(0,·).
export function relevanceScore(
  unit: EvidenceUnit,
  unitVector: number[],
  requirement: Requirement,
  requirementVector: number[],
  ctx: RelevanceContext,
): number {
  const w = ctx.weights;
  const cos = Math.max(0, cosine(unitVector, requirementVector));
  const tag = tagOverlap(unit, requirement.req);
  const recency = recencyScore(unit.recency, ctx.now);
  const rerank = clamp01(ctx.rerank ?? 0);
  return (
    w.alpha_cosine * cos +
    w.beta_tag * tag +
    w.gamma_rerank * rerank +
    w.delta_quality * clamp01(unit.quality_score) +
    w.epsilon_recency * recency
  );
}

// Build the full requirement × unit relevance matrix: matrix[r][e]. `rerank` is an
// optional lookup keyed by `${reqIndex}:${unitIndex}` for the flag-gated LLM pass.
export function buildRelevanceMatrix(input: {
  units: EvidenceUnit[];
  unitVectors: number[][];
  requirements: Requirement[];
  requirementVectors: number[][];
  weights: Weights;
  now?: Date;
  rerank?: Map<string, number>;
}): number[][] {
  const { units, unitVectors, requirements, requirementVectors, weights, now, rerank } = input;
  return requirements.map((req, r) =>
    units.map((unit, e) =>
      relevanceScore(unit, unitVectors[e], req, requirementVectors[r], {
        weights,
        now,
        rerank: rerank?.get(`${r}:${e}`),
      }),
    ),
  );
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
