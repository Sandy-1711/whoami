/** Provider credentials and model overrides, keyed by provider id. */
export interface LlmConfig {
  /** Preferred provider id. Empty means "Gemini if it has a key, else whatever does". */
  provider: string;
  /** Provider id to API key. A missing or empty value means the provider is unusable. */
  keys: Record<string, string>;
  /** Provider id to model override. Empty falls back to the provider's default. */
  models: Record<string, string>;
  /** Per-call timeout override (LLM_TIMEOUT_MS); 0 or absent uses the default. */
  timeoutMs?: number;
}

/** How long a single model call may run before it is aborted, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Attempts the AI SDK makes per call, including the first. Its retry already
 * backs off and honours `retry-after`, so nothing here re-implements that.
 */
export const DEFAULT_MAX_RETRIES = 2;
