// Provider-agnostic LLM layer. Callers build a prompt + JSON schema (in
// ./prompts.ts) and hand it here; this module picks the provider transport
// (./gemini.ts or ./deepseek.ts) and resolves the API key + model from config.
// Adding a provider means: a transport module, a branch in llmJson, and a case
// in resolveLlm — nothing else in the pipeline changes.
import type { JsonSchema } from './prompts.js';
import { env } from './env.js';
import { geminiJson } from './gemini.js';
import { deepseekJson } from './deepseek.js';

export type LlmProvider = 'gemini' | 'deepseek';

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
}

export interface LlmJsonArgs {
  prompt: string;
  schema: JsonSchema;
  llm: LlmConfig;
  temperature?: number;
}

const KEY_HINT: Record<LlmProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

export function isProvider(v: string): v is LlmProvider {
  return v === 'gemini' || v === 'deepseek';
}

// Resolve provider + key + model from an optional override (CLI flag) falling
// back to env. Throws a provider-specific message when the key is missing, so
// the tailor pipeline can fail fast before doing any real work.
export function resolveLlm(overrides: { provider?: string; model?: string } = {}): LlmConfig {
  const requested = (overrides.provider || '').toLowerCase();
  if (requested && !isProvider(requested)) {
    throw new Error(`Unknown LLM provider "${requested}" — use "gemini" or "deepseek".`);
  }
  const provider: LlmProvider = requested ? (requested as LlmProvider) : env.llmProvider;

  const apiKey = provider === 'deepseek' ? env.deepseekKey : env.geminiKey;
  if (!apiKey) {
    throw new Error(`${KEY_HINT[provider]} not set. Add it to .env (see .env.example).`);
  }
  const model =
    overrides.model || (provider === 'deepseek' ? env.deepseekModel : env.geminiModel);
  return { provider, apiKey, model };
}

// Core call: prompt + schema -> parsed object, routed to the chosen provider.
export function llmJson<T = unknown>({ prompt, schema, llm, temperature }: LlmJsonArgs): Promise<T> {
  const args = { prompt, schema, apiKey: llm.apiKey, model: llm.model, temperature };
  return llm.provider === 'deepseek' ? deepseekJson<T>(args) : geminiJson<T>(args);
}
