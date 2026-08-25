import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepSeek } from '@ai-sdk/deepseek';
import type { EmbeddingModel } from 'ai';
import type { LlmConfig } from './config.js';
import { LlmError } from './errors.js';

// The concrete model instance a provider returns. Deliberately not `ai`'s
// `LanguageModel` union, which widens to include a plain string and stops
// Mastra's Agent accepting it.
export type LanguageModel = ReturnType<ReturnType<typeof createGoogleGenerativeAI>>;

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
    // DeepSeek is OpenAI-compatible and shape-compatible with the Gemini
    // instance for our purposes; both are AI SDK language models.
    create: (apiKey, model) => createDeepSeek({ apiKey })(model) as unknown as LanguageModel,
  },
};

/** Gemini's current GA text embedding model. Only Gemini has an embedder here. */
const EMBEDDING_MODEL = 'gemini-embedding-001';

export function isProviderId(id: string): id is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(id);
}

/** A provider's built-in model, ignoring any config override. */
export function providerDefaultModel(id: ProviderId, { fast = false } = {}): string {
  return fast ? PROVIDERS[id].fastModel : PROVIDERS[id].defaultModel;
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

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  apiKeyEnv: string;
  modelEnv: string;
}

/** Every known provider, for status screens and for loading config from env. */
export function listProviders(): ProviderInfo[] {
  return PROVIDER_IDS.map((id) => ({
    id,
    label: PROVIDERS[id].label,
    defaultModel: PROVIDERS[id].defaultModel,
    apiKeyEnv: PROVIDERS[id].apiKeyEnv,
    modelEnv: PROVIDERS[id].modelEnv,
  }));
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
  // An explicit model wins, then an explicit `fast` (asking for cheap is an
  // intent a config-wide override should not defeat), then the config, then the
  // provider default.
  const modelId = selection.model
    || (selection.fast ? spec.fastModel : config.models[providerId] || spec.defaultModel);

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
