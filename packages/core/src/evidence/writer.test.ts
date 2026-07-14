import { describe, it, expect } from 'vitest';
import { writeBullets, checkGroundedness } from './writer.js';
import type { EvidenceUnit } from './store.js';
import type { LlmProvider, LlmRequest } from '../ports/llm.js';
import type { WriterResponse } from '../prompts.js';

const unit = (over: Partial<EvidenceUnit>): EvidenceUnit => ({
  id: over.id ?? 'u', claim: over.claim ?? 'built a thing', skills: over.skills ?? ['TS'],
  domains: [], provenance: [{ source: 'github', ref: 'r' }], quality_score: 0.8, tier: 'normal', ...over,
});

function provider(res: WriterResponse | Error): LlmProvider {
  return {
    id: 'f', label: 'F', model: 'm',
    async generateJson<T>(_r: LlmRequest): Promise<T> {
      if (res instanceof Error) throw res;
      return res as unknown as T;
    },
  };
}

describe('writeBullets', () => {
  it('shapes, cleans, and caps the drafted bullets', async () => {
    const units = [unit({ id: 'a' }), unit({ id: 'b' })];
    const out = await writeBullets({
      section: 'Experience', units, atsKeywords: ['TypeScript'], maxBullets: 2,
      provider: provider({ bullets: [
        { unit_id: 'a', text: '  Shipped X  ' },
        { unit_id: '', text: 'no id' },      // dropped
        { unit_id: 'b', text: 'Built Y' },
      ] }),
    });
    expect(out).toEqual([{ unit_id: 'a', text: 'Shipped X' }, { unit_id: 'b', text: 'Built Y' }]);
  });

  it('returns [] without calling the model when there are no units', async () => {
    let called = false;
    const p: LlmProvider = { id: 'f', label: 'F', model: 'm', async generateJson<T>() { called = true; return {} as T; } };
    expect(await writeBullets({ section: 's', units: [], atsKeywords: [], maxBullets: 3, provider: p })).toEqual([]);
    expect(called).toBe(false);
  });
});

describe('checkGroundedness', () => {
  const units = [
    unit({ id: 'a', claim: 'Cut token usage by 82%', impact: { metric: 'token reduction', value: '82%' } }),
    unit({ id: 'b', claim: 'Scaled platform to 10,000+ users' }),
  ];

  it('passes bullets that cite a unit and reuse its metrics verbatim', () => {
    const v = checkGroundedness([
      { unit_id: 'a', text: 'Cut routing-LLM token usage by 82% via dedup.' },
      { unit_id: 'b', text: 'Grew the platform to 10,000+ active users.' },
    ], units);
    expect(v).toEqual([]);
  });

  it('flags a bullet citing an unknown unit', () => {
    const v = checkGroundedness([{ unit_id: 'ghost', text: 'Did something.' }], units);
    expect(v).toHaveLength(1);
    expect(v[0].reason).toMatch(/not in the selected set/);
  });

  it('flags an invented/inflated metric not present in the unit', () => {
    const v = checkGroundedness([{ unit_id: 'a', text: 'Cut token usage by 95%.' }], units);
    expect(v).toHaveLength(1);
    expect(v[0].reason).toMatch(/metric "95%"/);
  });

  it('ignores bare years and trivial single digits', () => {
    const v = checkGroundedness([{ unit_id: 'b', text: 'Since 2024, scaled to 10,000+ users across 3 regions.' }], units);
    // 2024 (year) and 3 (single digit) are not gated; 10,000+ is grounded.
    expect(v).toEqual([]);
  });
});
