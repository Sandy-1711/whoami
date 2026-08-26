import { describe, expect, it } from 'vitest';
import { unbackedClaims } from './claims.js';
import type { Facts } from '../types.js';

const facts: Facts = {
  allowed_keywords: ['RAG', 'FastAPI'],
  skills: { AI: ['Langfuse'] },
  headline_metrics: ['16 merged PRs into Mastra', 'cut token usage 82%'],
};

describe('unbackedClaims', () => {
  it('backs what the fact base holds', () => {
    expect(unbackedClaims('Shipped RAG agents on FastAPI.', { facts })).toEqual([]);
  });

  it('flags a technology the candidate does not have', () => {
    expect(unbackedClaims('Ran the agents on Kubernetes.', { facts })).toContain('Kubernetes');
  });

  it('backs what the line being rewritten already claimed', () => {
    expect(
      unbackedClaims('Scaled Kubernetes jobs.', { facts, source: 'Ran Kubernetes jobs nightly.' }),
    ).toEqual([]);
  });

  it('flags an invented figure', () => {
    expect(unbackedClaims('Cut it by 95%.', { facts })).toContain('95%');
  });

  it('accepts a figure the fact base states, however it is written', () => {
    expect(unbackedClaims('Cut token usage 82%.', { facts })).toEqual([]);
    expect(unbackedClaims('Merged 16 PRs.', { facts })).toEqual([]);
  });
});
