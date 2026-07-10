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

export interface AppConfig {
  llm: LlmSettings;
  gmail: GmailSettings;
  githubToken: string;
  linkedinCookie: string;
  scrapeTtlHours: number;
}
