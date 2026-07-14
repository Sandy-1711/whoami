// Greedy coverage selector (architecture Layer 6, second half).
//
// Picks the evidence units that best COVER a JD's weighted requirements within a
// one-page budget. Coverage is submodular — coverage(r,S) = max_{e∈S} rel(e,r) —
// so a greedy "best marginal gain per cost" loop has the standard (1−1/e)
// guarantee and is cheap + deterministic. Each step also subtracts a redundancy
// penalty (λ · similarity to already-selected units) so near-duplicate proof
// isn't stacked. Pinned units are force-included; banned units are assumed
// already removed by curatedUnits() before the matrix is built.
import { cosine } from './embedding.js';
import type { EvidenceUnit } from './store.js';
import type { Requirement } from './requirements.js';
import type { Weights } from './relevance.js';

// Estimated rendered résumé lines for a unit — the "cost" the budget bounds.
// A bullet wraps at roughly 90 chars/line; everything is at least one line.
export function estimateCost(unit: EvidenceUnit): number {
  return Math.max(1, Math.ceil(unit.claim.length / 90));
}

export interface SelectorInput {
  units: EvidenceUnit[];
  unitVectors: number[][];   // aligned with units — used for redundancy
  requirements: Requirement[];
  relevance: number[][];     // matrix[requirement][unit] from buildRelevanceMatrix
  weights: Weights;          // uses lambda_redundancy
  budget: number;            // B, in cost units (≈ rendered lines)
  cost?: (unit: EvidenceUnit) => number;
  pinnedIds?: Set<string>;   // force-included regardless of budget
}

export interface SelectionResult {
  selected: EvidenceUnit[];
  selectedIds: string[];
  coverage: number[];  // final coverage per requirement (aligned with requirements)
  score: number;       // objective: Σ w_r·coverage(r) − λ·redundancy(S)
  totalCost: number;
  budget: number;
}

export function selectCoverage(input: SelectorInput): SelectionResult {
  const { units, unitVectors, requirements, relevance, weights, budget } = input;
  const cost = input.cost ?? estimateCost;
  const pinnedIds = input.pinnedIds ?? new Set<string>();
  const lambda = weights.lambda_redundancy;

  const coverage = requirements.map(() => 0);
  const chosen: number[] = [];
  const inSet = new Array(units.length).fill(false);
  let totalCost = 0;

  const applyPick = (e: number): void => {
    chosen.push(e);
    inSet[e] = true;
    totalCost += cost(units[e]);
    for (let r = 0; r < requirements.length; r++) {
      if (relevance[r][e] > coverage[r]) coverage[r] = relevance[r][e];
    }
  };

  // Force-include pinned units first (they win the budget).
  units.forEach((u, e) => {
    if (pinnedIds.has(u.id)) applyPick(e);
  });

  // Max cosine similarity of unit e to the currently-selected set (redundancy).
  const maxSimToSelected = (e: number): number => {
    let m = 0;
    for (const s of chosen) {
      if (s === e) continue;
      const sim = cosine(unitVectors[e], unitVectors[s]);
      if (sim > m) m = sim;
    }
    return m;
  };

  // Greedy: add the best marginal-gain-per-cost unit until nothing helps or the
  // budget is spent.
  for (;;) {
    let best = -1;
    let bestPerCost = 0;
    for (let e = 0; e < units.length; e++) {
      if (inSet[e]) continue;
      const c = cost(units[e]);
      if (totalCost + c > budget) continue;

      let deltaCoverage = 0;
      for (let r = 0; r < requirements.length; r++) {
        const gain = relevance[r][e] - coverage[r];
        if (gain > 0) deltaCoverage += requirements[r].weight * gain;
      }
      const marginal = deltaCoverage - lambda * maxSimToSelected(e);
      if (marginal <= 0) continue;
      const perCost = marginal / c;
      if (perCost > bestPerCost) {
        bestPerCost = perCost;
        best = e;
      }
    }
    if (best < 0) break;
    applyPick(best);
  }

  const selected = chosen.map((e) => units[e]);
  const score = requirements.reduce((s, r, i) => s + r.weight * coverage[i], 0)
    - lambda * totalRedundancy(chosen, unitVectors);

  return {
    selected,
    selectedIds: selected.map((u) => u.id),
    coverage,
    score,
    totalCost,
    budget,
  };
}

// Total pairwise redundancy of the selected set (sum of upper-triangle cosine).
function totalRedundancy(chosen: number[], vectors: number[][]): number {
  let total = 0;
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      total += Math.max(0, cosine(vectors[chosen[i]], vectors[chosen[j]]));
    }
  }
  return total;
}
