// LlmProviderRegistry — the provider-agnostic wiring. Domain code and the CLI
// hold a registry and ask it to resolve a configured provider; they never import
// a concrete provider. Adding a provider is `registry.register(fooFactory)` in
// the composition root — this file and every consumer stay untouched.
import type { AppConfig } from '../ports/config.js';
import type { HttpClient } from '../ports/http.js';
import type { LlmProvider, LlmProviderFactory } from '../ports/llm.js';

export interface ProviderSelection {
  provider?: string;
  model?: string;
}

export class LlmProviderRegistry {
  private readonly factories = new Map<string, LlmProviderFactory>();

  constructor(private readonly http: HttpClient) {}

  register(factory: LlmProviderFactory): this {
    this.factories.set(factory.id, factory);
    return this;
  }

  ids(): string[] {
    return [...this.factories.keys()];
  }

  list(): LlmProviderFactory[] {
    return [...this.factories.values()];
  }

  get(id: string): LlmProviderFactory | undefined {
    return this.factories.get(id);
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  // Which provider a config would use by default: an explicit LLM_PROVIDER that
  // is registered wins; else the first registered provider that has a key; else
  // the first registered provider (so error messages name the primary one).
  defaultProviderId(config: AppConfig): string {
    const explicit = (config.llm.provider || '').toLowerCase();
    if (explicit && this.factories.has(explicit)) return explicit;
    for (const factory of this.factories.values()) {
      if (config.llm.keys[factory.id]) return factory.id;
    }
    return this.factories.keys().next().value ?? '';
  }

  // Build a live provider from config + an optional explicit override. Throws a
  // provider-specific message when the required API key is missing.
  resolve(config: AppConfig, selection: ProviderSelection = {}): LlmProvider {
    const requested = (selection.provider || '').toLowerCase();
    if (requested && !this.factories.has(requested)) {
      throw new Error(`Unknown LLM provider "${requested}" — available: ${this.ids().join(', ') || '(none)'}.`);
    }
    const id = requested || this.defaultProviderId(config);
    const factory = this.factories.get(id);
    if (!factory) throw new Error('No LLM providers are registered.');

    const apiKey = config.llm.keys[id] || '';
    if (!apiKey) throw new Error(`${factory.apiKeyEnv} not set. Add it to .env (see .env.example).`);

    const model = selection.model || config.llm.models[id] || factory.defaultModel;
    return factory.create({ apiKey, model, http: this.http });
  }
}
