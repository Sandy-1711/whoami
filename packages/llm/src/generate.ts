import { SpanStatusCode, type Span } from '@opentelemetry/api';
import { generateObject } from 'ai';
import type { z } from 'zod';
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, type LlmConfig } from './config.js';
import { classifyLlmError, LlmError } from './errors.js';
import { resolveModel, type ModelSelection, type ProviderId } from './models.js';
import { getTracer, LANGFUSE_ATTR } from './tracing.js';

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

export interface ModelIdentity {
  providerId: ProviderId;
  modelId: string;
  label: string;
}

/**
 * The model gateway domain code depends on. Injected like every other adapter in
 * this repo, so a service can be tested against a fake with no network.
 */
export interface Llm {
  generateJson<T>(request: GenerateJsonRequest<T>): Promise<LlmResult<T>>;
  /**
   * Which provider and model a call would use, without making one — for
   * progress messages and reports.
   *
   * @throws {LlmError} kind `auth` when the chosen provider has no API key.
   */
  describe(selection?: ModelSelection): ModelIdentity;
}

function withTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

interface CallDescription {
  operation: string;
  providerId: ProviderId;
  modelId: string;
  temperature: number;
  prompt: string;
}

// The `gen_ai.*` names are load bearing: Langfuse's exporter decides whether a
// span is a model call by looking for them, and drops the ones without.
function describeCall(span: Span, call: CallDescription): void {
  span.setAttributes({
    'gen_ai.operation.name': 'generate_content',
    'gen_ai.system': call.providerId,
    'gen_ai.request.model': call.modelId,
    'gen_ai.request.temperature': call.temperature,
    [LANGFUSE_ATTR.observationType]: 'generation',
    [LANGFUSE_ATTR.traceName]: call.operation,
    [LANGFUSE_ATTR.input]: call.prompt,
  });
}

function recordFailure(span: Span, err: LlmError): void {
  span.recordException(err);
  span.setStatus({ code: SpanStatusCode.ERROR, message: err.describe() });
  span.setAttributes({
    [LANGFUSE_ATTR.level]: 'ERROR',
    [LANGFUSE_ATTR.statusMessage]: err.describe(),
    'error.type': err.kind,
  });
}

/**
 * Build the real gateway over a provider config.
 *
 * Every model call in the toolkit goes through the returned object, so timeouts,
 * error classification, and tracing apply in exactly one place. Retries are the
 * AI SDK's — it already backs off and honours `retry-after`.
 */
export function createLlm(config: LlmConfig, defaults: ModelSelection = {}): Llm {
  // A per-run override (the CLI's --provider/--model) applies to every call the
  // services make, since they select nothing themselves.
  const select = (selection?: ModelSelection): ModelSelection => ({ ...defaults, ...selection });

  return {
    describe(selection?: ModelSelection): ModelIdentity {
      const { providerId, modelId, label } = resolveModel(config, select(selection));
      return { providerId, modelId, label };
    },

    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<LlmResult<T>> {
      const {
        prompt,
        schema,
        operation,
        selection,
        temperature = 0.3,
        timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS,
        maxRetries = DEFAULT_MAX_RETRIES,
        signal,
      } = request;

      const { providerId, modelId, model } = resolveModel(config, select(selection));

      return getTracer().startActiveSpan(`llm.${operation}`, async (span) => {
        describeCall(span, { operation, providerId, modelId, temperature, prompt });

        try {
          const result = await generateObject({
            model,
            schema,
            prompt,
            temperature,
            maxRetries,
            abortSignal: withTimeout(timeoutMs, signal),
          });

          const usage = {
            inputTokens: result.usage?.inputTokens ?? 0,
            outputTokens: result.usage?.outputTokens ?? 0,
          };
          span.setAttributes({
            'gen_ai.usage.input_tokens': usage.inputTokens,
            'gen_ai.usage.output_tokens': usage.outputTokens,
            [LANGFUSE_ATTR.output]: JSON.stringify(result.object),
          });

          return { object: result.object, providerId, modelId, usage };
        } catch (err) {
          const failure = classifyLlmError(err, { provider: providerId, model: modelId });
          recordFailure(span, failure);
          throw failure;
        } finally {
          span.end();
        }
      });
    },
  };
}
