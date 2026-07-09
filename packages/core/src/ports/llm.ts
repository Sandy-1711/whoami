// LLM ports — the abstract side of the provider abstraction (DIP).
//
// Domain code (tailoring, scraping) depends ONLY on `LlmProvider`. Concrete
// providers implement `LlmProviderFactory` and self-describe their id, label,
// env key, and default model, so the registry can wire them without knowing any
// provider specifics. Adding a provider = one new factory file + one
// `registry.register(...)` call. Nothing else changes.
import type { HttpClient } from './http.js';

// A minimal subset of JSON Schema — what Gemini's responseSchema accepts, and
// (embedded in the prompt) what we ask schema-less providers to match.
export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
}

export interface LlmRequest {
  prompt: string;
  schema: JsonSchema;
  temperature?: number;
}

// One live, configured provider ready to answer prompts.
export interface LlmProvider {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  generateJson<T = unknown>(req: LlmRequest): Promise<T>;
}

// Everything the registry needs to describe and build a provider. Declaring the
// env var names here (not in a central config file) is what makes adding a
// provider a one-file change: the composition root reads these to wire keys.
export interface LlmProviderFactory {
  readonly id: string;          // 'gemini'
  readonly label: string;       // 'Gemini'
  readonly apiKeyEnv: string;   // 'GEMINI_API_KEY'
  readonly modelEnv?: string;   // 'GEMINI_MODEL'
  readonly defaultModel: string;// 'gemini-2.5-flash'
  create(config: LlmProviderConfig): LlmProvider;
}

export interface LlmProviderConfig {
  apiKey: string;
  model: string;
  http: HttpClient;
}
