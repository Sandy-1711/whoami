import { generateObject } from 'ai';
import type { z } from 'zod';
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, type LlmConfig } from './config.js';
import { classifyLlmError } from './errors.js';
import { resolveModel, type ModelSelection, type ProviderId } from './models.js';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResult<T> {
  object: T;
  providerId: ProviderId;
  modelId: string;
  usage: TokenUsage;
}

export interface GenerateJsonRequest<T> {
  /** The fully rendered prompt. Building it is the caller's job. */
  prompt: string;
  /** Shape the response must match. Validated by the SDK, so `object` is typed and real. */
  schema: z.ZodType<T>;
  /** Which pipeline this call belongs to — `tailor`, `email`, `outreach`, `chat`. */
  operation: string;
  /** Pick a provider or model for this call; omit to use the configured default. */
  selection?: ModelSelection;
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /** Caller cancellation, combined with the timeout. */
  signal?: AbortSignal;
}

function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Call a model and get back a validated object.
 *
 * Every model call in the toolkit goes through here, so timeouts, error
 * classification, and tracing are applied in exactly one place. Retries are the
 * AI SDK's — it already backs off and honours `retry-after`.
 *
 * @throws {LlmError} classified by kind, carrying the provider's own message.
 */
export async function generateJson<T>(
  config: LlmConfig,
  request: GenerateJsonRequest<T>,
): Promise<LlmResult<T>> {
  const {
    prompt,
    schema,
    selection,
    temperature = 0.3,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    signal,
  } = request;

  const { providerId, modelId, model } = resolveModel(config, selection);

  try {
    const result = await generateObject({
      model,
      schema,
      prompt,
      temperature,
      maxRetries,
      abortSignal: withTimeout(timeoutMs, signal),
    });

    return {
      object: result.object,
      providerId,
      modelId,
      usage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      },
    };
  } catch (err) {
    throw classifyLlmError(err, { provider: providerId, model: modelId });
  }
}
