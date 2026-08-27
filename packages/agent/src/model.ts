import {
  defaultProviderId,
  isProviderId,
  keyedProviders,
  providerDefaultModel,
  resolveEmbedder,
  resolveModel,
  type ModelSelection,
  type ProviderId,
  type ResolvedEmbedder,
  type ResolvedModel,
} from '@resume/llm';
import type { AppConfig } from '@resume/core';

export type AgentProviderId = ProviderId;
export type AgentModel = ResolvedModel;
export type AgentEmbedder = ResolvedEmbedder;

/** A runtime pick from the chat `/model` command, overriding config for the session. */
export interface AgentModelOverride {
  providerId: AgentProviderId;
  modelId: string;
}

// A pipeline-wide LLM_PROVIDER must not drag the chat loop onto a slower API, so
// chat prefers Gemini whenever it has a key. AGENT_PROVIDER overrides that.
function agentProviderId(config: AppConfig, override?: AgentModelOverride): AgentProviderId {
  const explicit = (override?.providerId || config.agent?.provider || '').toLowerCase();
  if (isProviderId(explicit) && config.llm.keys[explicit]) return explicit;
  if (config.llm.keys.gemini) return 'gemini';
  return defaultProviderId(config.llm);
}

// Chat is also decoupled from the pipeline model: GEMINI_MODEL may point at a pro
// tier for tailoring while the conversation stays on the fast default.
function agentSelection(config: AppConfig, override?: AgentModelOverride): ModelSelection {
  const provider = agentProviderId(config, override);
  return {
    provider,
    model: override?.modelId || config.agent?.model || providerDefaultModel(provider),
  };
}

/**
 * Build the chat model.
 *
 * @throws {LlmError} kind `auth` when the chosen provider has no API key.
 */
export function resolveAgentModel(config: AppConfig, override?: AgentModelOverride): AgentModel {
  return resolveModel(config.llm, agentSelection(config, override));
}

/** Providers the `/model` command may switch between without erroring. */
export function keyedAgentProviders(config: AppConfig): AgentProviderId[] {
  return keyedProviders(config.llm);
}

/**
 * The embedding model for semantic recall, or null when no Gemini key is set —
 * DeepSeek has no embedding endpoint, so recall stays off.
 */
export function resolveAgentEmbedder(config: AppConfig): AgentEmbedder | null {
  return resolveEmbedder(config.llm, config.agent?.embeddingModel || undefined);
}
