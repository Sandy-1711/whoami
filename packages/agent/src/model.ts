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

// Decide which provider the agent loop uses: an explicit AGENT_PROVIDER wins
// (if supported + keyed), else Gemini whenever a Gemini key exists — the chat
// loop wants low time-to-first-token and Gemini Flash delivers it, whereas an
// LLM_PROVIDER=deepseek set for the *pipelines* used to silently drag chat onto
// DeepSeek's slower API — else the pipeline's LLM_PROVIDER, else the first
// supported provider that has a key.
export function resolveAgentProviderId(config: AppConfig): AgentProviderId {
  const agentWanted = (config.agent?.provider || '').toLowerCase();
  if ((SUPPORTED as readonly string[]).includes(agentWanted) && config.llm.keys[agentWanted]) {
    return agentWanted as AgentProviderId;
  }
  if (config.llm.keys.gemini) return 'gemini';
  const pipeline = (config.llm.provider || '').toLowerCase();
  if ((SUPPORTED as readonly string[]).includes(pipeline) && config.llm.keys[pipeline]) {
    return pipeline as AgentProviderId;
  }
  const keyed = firstKeyedProvider(config);
  if (keyed) return keyed;
  // Nothing has a key — surface the wanted/first provider so the error names it.
  const wanted = agentWanted || pipeline;
  return (SUPPORTED as readonly string[]).includes(wanted) ? (wanted as AgentProviderId) : 'gemini';
}

// A runtime pick from the `/model` command: switch the agent to this exact
// provider+model for the session, overriding config/env resolution.
export interface AgentModelOverride {
  providerId: AgentProviderId;
  modelId: string;
}

// Build the chat model instance. An override (from `/model`) wins over config
// resolution. Throws a pointed error when the chosen provider has no key.
export function resolveAgentModel(config: AppConfig, override?: AgentModelOverride): AgentModel {
  const providerId = override?.providerId ?? resolveAgentProviderId(config);
  const apiKey = config.llm.keys[providerId] || '';
  if (!apiKey) {
    const envName = providerId === 'gemini' ? 'GEMINI_API_KEY' : 'DEEPSEEK_API_KEY';
    throw new Error(`${envName} not set — the chat agent needs a Gemini or DeepSeek key in .env.`);
  }
  // Chat model is decoupled from the pipeline's GEMINI_MODEL: an explicit
  // override (or AGENT_MODEL) wins, otherwise the fast chat default — NOT the
  // pro pipeline model.
  const modelId = override?.modelId || config.agent?.model || DEFAULT_CHAT_MODEL[providerId];

  const model = providerId === 'gemini'
    ? createGoogleGenerativeAI({ apiKey })(modelId)
    // DeepSeek is OpenAI-compatible; its model instance is shape-compatible with
    // the Gemini one for our purposes (both AI SDK language models).
    : (createDeepSeek({ apiKey })(modelId) as unknown as AgentModel['model']);

  return { providerId, modelId, label: LABEL[providerId], model };
}

// Which supported providers actually have a key — the set `/model` may switch
// between without erroring.
export function keyedAgentProviders(config: AppConfig): AgentProviderId[] {
  return SUPPORTED.filter((id) => !!config.llm.keys[id]);
}

// Build the embedding model for semantic recall, or null when no Gemini key is
// available (DeepSeek has no embedding adapter here → recall is disabled).
export function resolveAgentEmbedder(config: AppConfig): AgentEmbedder | null {
  const apiKey = config.llm.keys.gemini || '';
  if (!apiKey) return null;
  const modelId = config.agent?.embeddingModel || DEFAULT_EMBEDDING_MODEL;
  return { modelId, model: createGoogleGenerativeAI({ apiKey }).embeddingModel(modelId) };
}

// Thread titles don't need the main chat model — a one-line summary is a job
// for the cheapest fast model available. AGENT_TITLE_MODEL overrides.
const DEFAULT_TITLE_MODEL: Record<AgentProviderId, string> = {
  gemini: 'gemini-2.5-flash-lite',
  deepseek: 'deepseek-chat',
};

export function resolveTitleModel(config: AppConfig): AgentModel['model'] | null {
  const providerId: AgentProviderId | '' = config.llm.keys.gemini
    ? 'gemini'
    : config.llm.keys.deepseek ? 'deepseek' : '';
  if (!providerId) return null;
  const apiKey = config.llm.keys[providerId]!;
  const modelId = config.agent?.titleModel || DEFAULT_TITLE_MODEL[providerId];
  return providerId === 'gemini'
    ? createGoogleGenerativeAI({ apiKey })(modelId)
    : (createDeepSeek({ apiKey })(modelId) as unknown as AgentModel['model']);
}
