import { describe, expect, it } from 'vitest';
import type { LlmConfig } from './config.js';
import { LlmError } from './errors.js';
import { defaultProviderId, keyedProviders, resolveModel } from './models.js';

function config(overrides: Partial<LlmConfig> = {}): LlmConfig {
  return { provider: '', keys: {}, models: {}, ...overrides };
}

describe('defaultProviderId', () => {
  it('prefers Gemini when both providers have keys', () => {
    expect(defaultProviderId(config({ keys: { gemini: 'g', deepseek: 'd' } }))).toBe('gemini');
  });

  it('honours an explicit provider that has a key', () => {
    const c = config({ provider: 'deepseek', keys: { gemini: 'g', deepseek: 'd' } });
    expect(defaultProviderId(c)).toBe('deepseek');
  });

  it('ignores an explicit provider with no key', () => {
    const c = config({ provider: 'deepseek', keys: { gemini: 'g' } });
    expect(defaultProviderId(c)).toBe('gemini');
  });

  it('falls back to the only keyed provider', () => {
    expect(defaultProviderId(config({ keys: { deepseek: 'd' } }))).toBe('deepseek');
  });

  it('names Gemini when nothing has a key, so the error names a real provider', () => {
    expect(defaultProviderId(config())).toBe('gemini');
  });
});

describe('keyedProviders', () => {
  it('lists only providers with a non-empty key, in preference order', () => {
    expect(keyedProviders(config({ keys: { deepseek: 'd', gemini: 'g' } }))).toEqual([
      'gemini',
      'deepseek',
    ]);
    expect(keyedProviders(config({ keys: { gemini: '' } }))).toEqual([]);
  });
});

describe('resolveModel', () => {
  it('uses the provider default model', () => {
    const r = resolveModel(config({ keys: { gemini: 'g' } }));
    expect(r.providerId).toBe('gemini');
    expect(r.modelId).toBe('gemini-2.5-flash');
    expect(r.label).toBe('Gemini');
  });

  it('prefers a config model override over the default', () => {
    const c = config({ keys: { gemini: 'g' }, models: { gemini: 'gemini-2.5-pro' } });
    expect(resolveModel(c).modelId).toBe('gemini-2.5-pro');
  });

  it('prefers an explicit model over the config override', () => {
    const c = config({ keys: { gemini: 'g' }, models: { gemini: 'gemini-2.5-pro' } });
    expect(resolveModel(c, { model: 'gemini-2.0-flash' }).modelId).toBe('gemini-2.0-flash');
  });

  it('picks the cheap model when fast is set', () => {
    const r = resolveModel(config({ keys: { gemini: 'g' } }), { fast: true });
    expect(r.modelId).toBe('gemini-2.5-flash-lite');
  });

  it('lets an explicit model win over fast', () => {
    const c = config({ keys: { gemini: 'g' } });
    expect(resolveModel(c, { fast: true, model: 'gemini-2.5-pro' }).modelId).toBe('gemini-2.5-pro');
  });

  it('throws an auth error naming the env var when the key is missing', () => {
    try {
      resolveModel(config({ keys: { deepseek: 'd' } }), { provider: 'gemini' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      expect((err as LlmError).kind).toBe('auth');
      expect((err as LlmError).message).toContain('GEMINI_API_KEY');
    }
  });

  it('rejects an unregistered provider by name', () => {
    try {
      resolveModel(config({ keys: { gemini: 'g' } }), { provider: 'openrouter' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as LlmError).message).toContain('openrouter');
      expect((err as LlmError).message).toContain('gemini, deepseek');
    }
  });
});
