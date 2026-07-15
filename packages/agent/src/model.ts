// Model resolution for the chat agent. Maps the typed AppConfig into concrete
// AI SDK model instances that Mastra's Agent + Memory consume.
//
// The deterministic pipelines (tailor/email/wellfound) keep using @resume/core's
// LlmProvider registry — this module is ONLY for the conversational loop and its
// embeddings. We construct the AI SDK provider with the API key from AppConfig
// explicitly, never relying on the SDK's own env var names, so a single .env
// drives both worlds.
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepSeek } from '@ai-sdk/deepseek';
import type { AppConfig } from '@resume/core';

// Providers we can build a chat model for. (The registry may know more providers
// for JSON pipelines, but only these have an AI SDK chat adapter wired here.)
const SUPPORTED = ['gemini', 'deepseek'] as const;
export type AgentProviderId = (typeof SUPPORTED)[number];

// Chat defaults to a FAST, CHEAP model — the conversational loop runs often and
// wants low latency + low cost, unlike the occasional résumé/email pipelines
// (which stay on whatever GEMINI_MODEL is set to, typically the pro tier). Set
// AGENT_MODEL to override (e.g. gemini-2.5-pro for depth, gemini-2.5-flash-lite
// for the cheapest).
const DEFAULT_CHAT_MODEL: Record<AgentProviderId, string> = {
  gemini: 'gemini-2.5-flash',
  deepseek: 'deepseek-chat',
};

const LABEL: Record<AgentProviderId, string> = { gemini: 'Gemini', deepseek: 'DeepSeek' };

// Gemini's current GA text embedding model. Only Gemini has an embedding adapter
// here; a DeepSeek-only setup runs the agent without semantic recall.
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';

export interface AgentModel {
  providerId: AgentProviderId;
  modelId: string;
  label: string;
  // AI SDK language model instance, passed straight to `new Agent({ model })`.
  model: ReturnType<ReturnType<typeof createGoogleGenerativeAI>>;
}

export interface AgentEmbedder {
  modelId: string;
  // AI SDK embedding model instance, passed to `new Memory({ embedder })`.
  model: ReturnType<ReturnType<typeof createGoogleGenerativeAI>['embeddingModel']>;
}

function firstKeyedProvider(config: AppConfig): AgentProviderId | '' {
  for (const id of SUPPORTED) {
    if (config.llm.keys[id]) return id;
  }
  return '';
}

// Decide which provider the agent loop uses: an explicit AGENT_PROVIDER wins (if
// supported + keyed), else the pipeline's LLM_PROVIDER, else the first supported
// provider that has a key.
export function resolveAgentProviderId(config: AppConfig): AgentProviderId {
  const wanted = (config.agent?.provider || config.llm.provider || '').toLowerCase();
  if ((SUPPORTED as readonly string[]).includes(wanted) && config.llm.keys[wanted]) {
    return wanted as AgentProviderId;
  }
  const keyed = firstKeyedProvider(config);
  if (keyed) return keyed;
  // Nothing has a key — surface the wanted/first provider so the error names it.
  return (SUPPORTED as readonly string[]).includes(wanted) ? (wanted as AgentProviderId) : 'gemini';
}

// Build the chat model instance. Throws a pointed error when the key is missing.
export function resolveAgentModel(config: AppConfig): AgentModel {
  const providerId = resolveAgentProviderId(config);
  const apiKey = config.llm.keys[providerId] || '';
  if (!apiKey) {
    const envName = providerId === 'gemini' ? 'GEMINI_API_KEY' : 'DEEPSEEK_API_KEY';
    throw new Error(`${envName} not set — the chat agent needs a Gemini or DeepSeek key in .env.`);
  }
  // Chat model is decoupled from the pipeline's GEMINI_MODEL: an explicit
  // AGENT_MODEL wins, otherwise the fast chat default — NOT the pro pipeline model.
  const modelId = config.agent?.model || DEFAULT_CHAT_MODEL[providerId];

  const model = providerId === 'gemini'
    ? createGoogleGenerativeAI({ apiKey })(modelId)
    // DeepSeek is OpenAI-compatible; its model instance is shape-compatible with
    // the Gemini one for our purposes (both AI SDK language models).
    : (createDeepSeek({ apiKey })(modelId) as unknown as AgentModel['model']);

  return { providerId, modelId, label: LABEL[providerId], model };
}

// Build the embedding model for semantic recall, or null when no Gemini key is
// available (DeepSeek has no embedding adapter here → recall is disabled).
export function resolveAgentEmbedder(config: AppConfig): AgentEmbedder | null {
  const apiKey = config.llm.keys.gemini || '';
  if (!apiKey) return null;
  const modelId = config.agent?.embeddingModel || DEFAULT_EMBEDDING_MODEL;
  return { modelId, model: createGoogleGenerativeAI({ apiKey }).embeddingModel(modelId) };
}
