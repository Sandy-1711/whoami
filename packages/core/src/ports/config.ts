// Configuration port — a typed view of the environment the domain needs. The
// concrete implementation (apps/cli) loads .env; tests pass a plain object. Core
// never reads process.env directly, so it stays pure and testable.

export interface LlmSettings {
  // Explicit default provider id, or '' to let the registry auto-pick.
  provider: string;
  // Per-provider API keys and model overrides, keyed by provider id.
  keys: Record<string, string>;
  models: Record<string, string>;
}

export interface GmailSettings {
  // The Gmail address emails are sent from.
  user: string;
  // A Google App Password (not the account password). Whitespace is tolerated —
  // Google displays it in spaced groups of four.
  appPassword: string;
}

// Chat-agent runtime settings. The deterministic pipelines (tailor/email/…)
// keep using LlmSettings + the provider registry; these only steer the Mastra
// conversation loop and its embeddings. All optional overrides — blank falls
// back to the same provider chain the pipelines use.
export interface AgentSettings {
  // Provider id for the agent loop (AGENT_PROVIDER); '' → reuse llm.provider / first key.
  provider: string;
  // Chat model override (AGENT_MODEL); '' → provider default.
  model: string;
  // Embedding model for semantic recall (AGENT_EMBEDDING_MODEL); '' → provider default.
  embeddingModel: string;
}

export interface AppConfig {
  llm: LlmSettings;
  gmail: GmailSettings;
  githubToken: string;
  linkedinCookie: string;
  scrapeTtlHours: number;
  // Present when the CLI loads the agent; older call sites (tests) may omit it.
  agent?: AgentSettings;
}
