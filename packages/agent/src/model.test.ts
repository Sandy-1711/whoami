import { describe, it, expect } from 'vitest';
import type { AppConfig } from '@resume/core';
import { resolveAgentProviderId, resolveAgentModel, resolveAgentEmbedder, resolveTitleModel } from './model.js';

function config(over: Partial<AppConfig> = {}): AppConfig {
  return {
    llm: { provider: '', keys: {}, models: {}, ...(over.llm || {}) },
    gmail: { user: '', appPassword: '' },
    githubToken: '',
    linkedinCookie: '',
    scrapeTtlHours: 12,
    agent: over.agent,
  };
}

// Shorthand for a full AgentSettings with overrides.
function agentSettings(over: Partial<NonNullable<AppConfig['agent']>> = {}): NonNullable<AppConfig['agent']> {
  return { provider: '', model: '', embeddingModel: '', recall: false, titleModel: '', ...over };
}

describe('resolveAgentProviderId', () => {
  it('auto-picks the first supported provider that has a key', () => {
    expect(resolveAgentProviderId(config({ llm: { provider: '', keys: { deepseek: 'k' }, models: {} } }))).toBe('deepseek');
  });

  it('honours AGENT_PROVIDER when it is supported and keyed', () => {
    const c = config({
      llm: { provider: 'gemini', keys: { gemini: 'g', deepseek: 'd' }, models: {} },
      agent: agentSettings({ provider: 'deepseek' }),
    });
    expect(resolveAgentProviderId(c)).toBe('deepseek');
  });

  it('prefers Gemini for chat even when the pipeline LLM_PROVIDER is deepseek', () => {
    // Chat wants low TTFT — LLM_PROVIDER steers the pipelines, not the chat loop.
    const c = config({ llm: { provider: 'deepseek', keys: { gemini: 'g', deepseek: 'd' }, models: {} } });
    expect(resolveAgentProviderId(c)).toBe('gemini');
  });

  it('follows LLM_PROVIDER when no Gemini key exists', () => {
    const c = config({ llm: { provider: 'deepseek', keys: { deepseek: 'd' }, models: {} } });
    expect(resolveAgentProviderId(c)).toBe('deepseek');
  });

  it('ignores an AGENT_PROVIDER that has no key', () => {
    const c = config({
      llm: { provider: '', keys: { gemini: 'g' }, models: {} },
      agent: agentSettings({ provider: 'deepseek' }),
    });
    expect(resolveAgentProviderId(c)).toBe('gemini');
  });
});

describe('resolveTitleModel', () => {
  it('is null when nothing has a key', () => {
    expect(resolveTitleModel(config())).toBeNull();
  });

  it('builds a model when a key exists', () => {
    expect(resolveTitleModel(config({ llm: { provider: '', keys: { gemini: 'g' }, models: {} } }))).toBeTruthy();
    expect(resolveTitleModel(config({ llm: { provider: '', keys: { deepseek: 'd' }, models: {} } }))).toBeTruthy();
  });
});

describe('resolveAgentModel', () => {
  it('throws a keyed error when the resolved provider has no key', () => {
    expect(() => resolveAgentModel(config())).toThrow(/GEMINI_API_KEY/);
  });

  it('uses AGENT_MODEL over the provider default', () => {
    const c = config({
      llm: { provider: '', keys: { gemini: 'g' }, models: {} },
      agent: agentSettings({ model: 'gemini-2.5-flash' }),
    });
    const m = resolveAgentModel(c);
    expect(m.providerId).toBe('gemini');
    expect(m.modelId).toBe('gemini-2.5-flash');
    expect(m.label).toBe('Gemini');
  });

  it('uses the fast chat default, decoupled from the pipeline model (GEMINI_MODEL)', () => {
    // The chat loop must NOT inherit the pro pipeline model — it defaults to the
    // fast/cheap chat model even when models[provider] is set.
    const gem = resolveAgentModel(config({ llm: { provider: '', keys: { gemini: 'g' }, models: { gemini: 'gemini-2.5-pro' } } }));
    expect(gem.modelId).toBe('gemini-2.5-flash');
    const ds = resolveAgentModel(config({ llm: { provider: '', keys: { deepseek: 'k' }, models: { deepseek: 'deepseek-reasoner' } } }));
    expect(ds.modelId).toBe('deepseek-chat');
  });
});

describe('resolveAgentEmbedder', () => {
  it('is null without a Gemini key (recall disabled)', () => {
    expect(resolveAgentEmbedder(config({ llm: { provider: '', keys: { deepseek: 'k' }, models: {} } }))).toBeNull();
  });

  it('builds a Gemini embedder when a key is present', () => {
    const e = resolveAgentEmbedder(config({ llm: { provider: '', keys: { gemini: 'g' }, models: {} } }));
    expect(e?.modelId).toBe('gemini-embedding-001');
  });
});
