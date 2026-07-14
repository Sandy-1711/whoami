import { describe, it, expect } from 'vitest';
import { selectCoverage, estimateCost } from './selector.js';
import { DEFAULT_WEIGHTS } from './relevance.js';
import type { EvidenceUnit } from './store.js';
import type { Requirement } from './requirements.js';

const unit = (id: string, claim = 'c'): EvidenceUnit => ({
  id, claim, skills: [], domains: [], provenance: [{ source: 'github', ref: 'r' }],
  quality_score: 0.5, tier: 'normal',
});

const reqs: Requirement[] = [{ req: 'r0', weight: 1 }, { req: 'r1', weight: 1 }];

describe('estimateCost', () => {
  it('is at least 1 line and grows with claim length', () => {
    expect(estimateCost(unit('a', 'short'))).toBe(1);
    expect(estimateCost(unit('a', 'x'.repeat(200)))).toBe(3);
  });
});

describe('selectCoverage', () => {
  it('prefers a unit that covers both requirements over two single-requirement units', () => {
    const units = [unit('both'), unit('r0only'), unit('r1only')];
    const vectors = [[1, 1], [1, 0], [0, 1]];
    // matrix[req][unit]
    const relevance = [
      [0.9, 0.8, 0.1], // r0
      [0.9, 0.1, 0.8], // r1
    ];
    const res = selectCoverage({
      units, unitVectors: vectors, requirements: reqs, relevance,
      weights: DEFAULT_WEIGHTS, budget: 1, // room for exactly one unit
    });
    expect(res.selectedIds).toEqual(['both']);
    expect(res.coverage).toEqual([0.9, 0.9]);
  });

  it('respects the budget (cost sum never exceeds B)', () => {
    const units = [unit('a', 'x'.repeat(180)), unit('b', 'x'.repeat(180)), unit('c', 'x'.repeat(180))]; // cost 2 each
    const vectors = [[1, 0], [0, 1], [1, 1]];
    const relevance = [[0.9, 0.8, 0.7], [0.7, 0.9, 0.6]];
    const res = selectCoverage({ units, unitVectors: vectors, requirements: reqs, relevance, weights: DEFAULT_WEIGHTS, budget: 3 });
    expect(res.totalCost).toBeLessThanOrEqual(3);
    expect(res.selected.length).toBe(1); // only one cost-2 unit fits in budget 3
  });

  it('force-includes pinned units even past the budget', () => {
    const units = [unit('pin', 'x'.repeat(180)), unit('a')];
    const vectors = [[1, 0], [0, 1]];
    const relevance = [[0.1, 0.9], [0.1, 0.9]];
    const res = selectCoverage({
      units, unitVectors: vectors, requirements: reqs, relevance,
      weights: DEFAULT_WEIGHTS, budget: 1, pinnedIds: new Set(['pin']),
    });
    expect(res.selectedIds).toContain('pin');
    expect(res.totalCost).toBeGreaterThanOrEqual(2); // pinned exceeded budget but was forced
  });

  it('penalizes redundant near-duplicate units', () => {
    const units = [unit('a'), unit('dup'), unit('diverse')];
    const vectors = [[1, 0], [0.99, 0.01], [0, 1]]; // dup ~ a; diverse orthogonal
    const relevance = [
      [0.9, 0.89, 0.5], // r0
      [0.2, 0.2, 0.9],  // r1
    ];
    const res = selectCoverage({ units, unitVectors: vectors, requirements: reqs, relevance, weights: DEFAULT_WEIGHTS, budget: 2 });
    // After picking 'a', 'diverse' (covers r1, no redundancy) beats 'dup' (redundant with a).
    expect(res.selectedIds).toContain('a');
    expect(res.selectedIds).toContain('diverse');
    expect(res.selectedIds).not.toContain('dup');
  });

  it('returns an empty selection when nothing fits or helps', () => {
    const res = selectCoverage({ units: [], unitVectors: [], requirements: reqs, relevance: [[], []], weights: DEFAULT_WEIGHTS, budget: 5 });
    expect(res.selected).toEqual([]);
    expect(res.score).toBe(0);
  });
});
