import { describe, it, expect } from 'vitest';
import { LlmProviderRegistry } from './registry.js';
import { geminiFactory } from './providers/gemini.js';
import { deepseekFactory } from './providers/deepseek.js';
import type { AppConfig } from '../ports/config.js';
import type { HttpClient } from '../ports/http.js';
import type { LlmProviderFactory } from '../ports/llm.js';

// A no-op HttpClient — resolve() never makes a call, so this is only a stub.
const http: HttpClient = {
  async post() {
    return { ok: true, status: 200, async text() { return ''; }, async json() { return {}; } };
  },
};

function config(llm: Partial<AppConfig['llm']> = {}): AppConfig {
  return {
    llm: { provider: '', keys: {}, models: {}, ...llm },
    gmail: { user: '', appPassword: '' },
    githubToken: '',
    linkedinCookie: '',
    scrapeTtlHours: 12,
  };
}

function registry(): LlmProviderRegistry {
  return new LlmProviderRegistry(http).register(geminiFactory).register(deepseekFactory);
}

describe('LlmProviderRegistry', () => {
  it('auto-picks the first provider that has a key', () => {
    const p = registry().resolve(config({ keys: { deepseek: 'dk' } }));
    expect(p.id).toBe('deepseek');
    expect(p.model).toBe(deepseekFactory.defaultModel);
  });

  it('honors an explicit provider selection over the env default', () => {
    const cfg = config({ provider: 'gemini', keys: { gemini: 'gk', deepseek: 'dk' } });
    expect(registry().resolve(cfg, { provider: 'deepseek' }).id).toBe('deepseek');
  });

  it('applies a per-run model override, then the env model, then the default', () => {
    const cfg = config({ keys: { gemini: 'gk' }, models: { gemini: 'gemini-2.5-pro' } });
    expect(registry().resolve(cfg).model).toBe('gemini-2.5-pro');
    expect(registry().resolve(cfg, { model: 'gemini-flash-lite' }).model).toBe('gemini-flash-lite');
  });

  it('throws a provider-specific error when the key is missing', () => {
    expect(() => registry().resolve(config({ provider: 'gemini' }))).toThrow(/GEMINI_API_KEY not set/);
  });

  it('rejects an unknown provider id', () => {
    expect(() => registry().resolve(config(), { provider: 'bogus' })).toThrow(/Unknown LLM provider/);
  });

  // The whole point of the refactor: a brand-new provider drops in via one
  // factory + one register() call. No other core module is touched or imported.
  it('accepts a new provider with no changes to existing code', async () => {
    const grokFactory: LlmProviderFactory = {
      id: 'grok',
      label: 'Grok',
      apiKeyEnv: 'GROK_API_KEY',
      defaultModel: 'grok-2',
      create({ model }) {
        return {
          id: 'grok', label: 'Grok', model,
          async generateJson<T>() { return { ok: true } as T; },
        };
      },
    };
    const reg = registry().register(grokFactory);
    expect(reg.ids()).toContain('grok');

    const provider = reg.resolve(config({ provider: 'grok', keys: { grok: 'xai' } }));
    expect(provider.id).toBe('grok');
    await expect(provider.generateJson({ prompt: 'hi', schema: { type: 'object' } })).resolves.toEqual({ ok: true });
  });
});
