// Configuration port — a typed view of the environment the domain needs. The
// concrete implementation (apps/cli) loads .env; tests pass a plain object. Core
// never reads process.env directly, so it stays pure and testable.

import type { LlmConfig, TracingConfig } from '@resume/llm';

// The gateway owns the shape; this alias keeps the existing AppConfig.llm name.
export type LlmSettings = LlmConfig;

// Langfuse connection settings, owned by the gateway for the same reason.
export type LangfuseSettings = TracingConfig;

export interface GmailSettings {
  // The Gmail address emails are sent from.
  user: string;
  // A Google App Password (not the account password). Whitespace is tolerated —
  // Google displays it in spaced groups of four.
  appPassword: string;
}

// Chat-agent runtime settings. These steer only the Mastra conversation loop and
// its embeddings; the pipelines read LlmSettings directly. All optional — blank
// falls back to the same provider chain the pipelines use.
export interface AgentSettings {
  // Provider id for the agent loop (AGENT_PROVIDER); '' → the pipeline default.
  provider: string;
  // Chat model override (AGENT_MODEL); '' → provider default.
  model: string;
  // Embedding model for semantic recall (AGENT_EMBEDDING_MODEL); '' → provider default.
  embeddingModel: string;
  // Semantic recall is opt-in (AGENT_RECALL=1): it adds an embedding round-trip
  // before every turn, so it's off by default to keep chat latency down.
  recall: boolean;
}

export interface AppConfig {
  llm: LlmSettings;
  gmail: GmailSettings;
  githubToken: string;
  linkedinCookie: string;
  scrapeTtlHours: number;
  // Present when the CLI loads the agent; older call sites (tests) may omit it.
  agent?: AgentSettings;
  // Absent, disabled, or half-configured all mean the same thing: no tracing.
  langfuse?: LangfuseSettings;
}
