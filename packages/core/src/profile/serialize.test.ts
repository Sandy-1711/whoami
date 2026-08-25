import { describe, expect, it } from 'vitest';
import type { Facts } from '../types.js';
import { DEFAULT_FACTS_BUDGET, serializeFacts } from './serialize.js';

const FACTS: Facts = {
  identity: { name: 'Sandeep Singh', github: 'Sandy-1711' },
  headline_metrics: ['16 merged PRs into Mastra', 'scaled to 10,000+ users'],
  experience: [{ org: 'AiRA', keywords: ['RAG', 'asyncio'] }],
  projects: [{ org: 'voice-sdk', keywords: ['TypeScript'] }],
  skills: { Languages: ['TypeScript', 'Python'] },
  title_variants: ['AI Engineer'],
  seniority: 'early-career',
  allowed_keywords: ['RAG', 'LLM', 'agents'],
} as Facts;

describe('serializeFacts', () => {
  it('returns the whole fact base when it fits', () => {
    const { json, dropped } = serializeFacts(FACTS);
    expect(dropped).toEqual([]);
    expect(JSON.parse(json)).toEqual(FACTS);
  });

  it('leaves a real fact base untouched under the default budget', () => {
    const { dropped } = serializeFacts(FACTS, DEFAULT_FACTS_BUDGET);
    expect(dropped).toEqual([]);
  });

  it('always produces parseable JSON, even under a tiny budget', () => {
    for (const budget of [10, 50, 120, 300, 800]) {
      const { json } = serializeFacts(FACTS, budget);
      expect(() => JSON.parse(json)).not.toThrow();
    }
  });

  it('drops allowed_keywords before headline_metrics', () => {
    const budget = JSON.stringify(FACTS).length - 20;
    const { json, dropped } = serializeFacts(FACTS, budget);
    expect(dropped).toContain('allowed_keywords');
    expect(JSON.parse(json)).toHaveProperty('headline_metrics');
  });

  it('keeps identity and headline_metrics under heavy pressure', () => {
    const { json } = serializeFacts(FACTS, 220);
    const kept = JSON.parse(json);
    expect(kept).toHaveProperty('identity');
    expect(kept).toHaveProperty('headline_metrics');
  });

  it('reports every section it left out', () => {
    const { json, dropped } = serializeFacts(FACTS, 220);
    const kept = Object.keys(JSON.parse(json));
    for (const section of dropped) expect(kept).not.toContain(section);
    expect(dropped.length).toBeGreaterThan(0);
  });

  it('never emits a section partially', () => {
    const { json } = serializeFacts(FACTS, 260);
    const kept = JSON.parse(json);
    if (kept.headline_metrics) expect(kept.headline_metrics).toEqual(FACTS.headline_metrics);
    if (kept.experience) expect(kept.experience).toEqual(FACTS.experience);
  });

  it('carries unknown sections through after the ranked ones', () => {
    const extra = { ...FACTS, custom_section: ['kept'] } as Facts;
    const { json, dropped } = serializeFacts(extra);
    expect(dropped).toEqual([]);
    expect(JSON.parse(json)).toHaveProperty('custom_section');
  });
});
