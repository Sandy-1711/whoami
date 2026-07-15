import { describe, it, expect } from 'vitest';
import { CHAT_MODELS, chatModelInfo, estimateCost } from './pricing.js';

describe('chatModelInfo', () => {
  it('returns the catalog entry for a known model', () => {
    const info = chatModelInfo('gemini-2.5-flash', 'gemini');
    expect(info.label).toBe('Gemini 2.5 Flash');
    expect(info.contextWindow).toBeGreaterThan(0);
    expect(info.inputPer1M).toBeGreaterThan(0);
  });

  it('falls back to a neutral, zero-price entry for an unknown model', () => {
    const info = chatModelInfo('gemini-9.9-turbo', 'gemini');
    expect(info.modelId).toBe('gemini-9.9-turbo');
    expect(info.label).toBe('gemini-9.9-turbo');
    expect(info.inputPer1M).toBe(0);
    expect(info.outputPer1M).toBe(0);
    expect(info.contextWindow).toBe(1_048_576); // gemini default window
  });

  it('uses the deepseek default window for unknown deepseek models', () => {
    expect(chatModelInfo('deepseek-x', 'deepseek').contextWindow).toBe(131_072);
  });
});

describe('estimateCost', () => {
  it('prices input and output tokens per 1M', () => {
    const info = chatModelInfo('gemini-2.5-flash', 'gemini'); // $0.30 in / $2.50 out
    // 1M in + 1M out = 0.30 + 2.50 = 2.80
    expect(estimateCost(info, 1_000_000, 1_000_000)).toBeCloseTo(2.8, 6);
  });

  it('is zero for a zero-price (unknown) model', () => {
    expect(estimateCost(chatModelInfo('mystery', 'gemini'), 5000, 5000)).toBe(0);
  });
});

describe('CHAT_MODELS catalog', () => {
  it('every entry has a positive context window and a supported provider', () => {
    for (const m of CHAT_MODELS) {
      expect(m.contextWindow).toBeGreaterThan(0);
      expect(['gemini', 'deepseek']).toContain(m.providerId);
    }
  });
});
