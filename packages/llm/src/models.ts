import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepSeek } from '@ai-sdk/deepseek';
import type { EmbeddingModel, LanguageModel } from 'ai';
import type { LlmConfig } from './config.js';
import { LlmError } from './errors.js';

/** Providers this toolkit can talk to, in preference order. */
export const PROVIDER_IDS = ['gemini', 'deepseek'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

interface ProviderSpec {
  label: string;
  apiKeyEnv: string;
  modelEnv: string;
  defaultModel: string;
  /** Cheapest model that can still do a one-line job (thread titles, labels). */
  fastModel: string;
  create(apiKey: string, model: string): LanguageModel;
}

const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  gemini: {
    label: 'Gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-2.5-flash',
    fastModel: 'gemini-2.5-flash-lite',
    create: (apiKey, model) => createGoogleGenerativeAI({ apiKey })(model),
  },
  deepseek: {
    label: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    modelEnv: 'DEEPSEEK_MODEL',
    defaultModel: 'deepseek-chat',
    fastModel: 'deepseek-chat',
    create: (apiKey, model) => createDeepSeek({ apiKey })(model),
  },
};

/** Gemini's current GA text embedding model. Only Gemini has an embedder here. */
const EMBEDDING_MODEL = 'gemini-embedding-001';

function isProviderId(id: string): id is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(id);
}

/** Providers that have an API key configured, in preference order. */
export function keyedProviders(config: LlmConfig): ProviderId[] {
  return PROVIDER_IDS.filter((id) => Boolean(config.keys[id]));
}

/**
 * Which provider a call uses when none is named: an explicit, keyed
 * `config.provider` wins, then Gemini, then whatever else has a key. Falls back
 * to Gemini with no key so the resulting error names a real provider.
 */
export function defaultProviderId(config: LlmConfig): ProviderId {
  const wanted = (config.provider || '').toLowerCase();
  if (isProviderId(wanted) && config.keys[wanted]) return wanted;
  return keyedProviders(config)[0] ?? 'gemini';
}

/** Human-readable name for a provider, for spinners and reports. */
export function providerLabel(id: ProviderId): string {
  return PROVIDERS[id].label;
}

/** Environment variable names a provider reads, for setup messages. */
export function providerEnv(id: ProviderId): { apiKeyEnv: string; modelEnv: string } {
  const { apiKeyEnv, modelEnv } = PROVIDERS[id];
  return { apiKeyEnv, modelEnv };
}

export interface ModelSelection {
  /** Provider id; omit to use {@link defaultProviderId}. */
  provider?: string;
  /** Exact model id; omit to use the config override, then the provider default. */
  model?: string;
  /** Prefer the provider's cheapest model. Ignored when `model` is given. */
  fast?: boolean;
}

export interface ResolvedModel {
  providerId: ProviderId;
  modelId: string;
  label: string;
  model: LanguageModel;
}

/**
 * Build a ready language model from config plus an optional override.
 *
 * @throws {LlmError} kind `auth` when the chosen provider has no API key.
 */
export function resolveModel(config: LlmConfig, selection: ModelSelection = {}): ResolvedModel {
  const requested = (selection.provider || '').toLowerCase();
  if (requested && !isProviderId(requested)) {
    throw new LlmError(
      'unknown',
      `Unknown provider "${requested}" — available: ${PROVIDER_IDS.join(', ')}.`,
      { provider: requested, model: selection.model || '' },
    );
  }

  const providerId = requested ? (requested as ProviderId) : defaultProviderId(config);
  const spec = PROVIDERS[providerId];
  const modelId =
    selection.model || config.models[providerId] || (selection.fast ? spec.fastModel : spec.defaultModel);

  const apiKey = config.keys[providerId] || '';
  if (!apiKey) {
    throw new LlmError('auth', `${spec.apiKeyEnv} is not set. Add it to .env (see .env.example).`, {
      provider: providerId,
      model: modelId,
    });
  }

  return {
    providerId,
    modelId,
    label: spec.label,
    model: spec.create(apiKey, modelId),
  };
}

export interface ResolvedEmbedder {
  modelId: string;
  model: EmbeddingModel;
}

/**
 * Build the embedding model for semantic recall, or null when no Gemini key is
 * available — DeepSeek has no embedding endpoint here, so recall stays off.
 */
export function resolveEmbedder(config: LlmConfig, modelId = EMBEDDING_MODEL): ResolvedEmbedder | null {
  const apiKey = config.keys.gemini || '';
  if (!apiKey) return null;
  return { modelId, model: createGoogleGenerativeAI({ apiKey }).textEmbeddingModel(modelId) };
}
