import type { GenerateJsonRequest, Llm, LlmResult, TokenUsage } from '../generate.js';
import { LlmError, type LlmErrorKind } from '../errors.js';

export interface FakeCall {
  operation: string;
  prompt: string;
}

export interface FakeLlmOptions {
  /**
   * Objects returned in order, one per call. The last one repeats once the list
   * is exhausted, so a test that calls twice need only supply what it asserts on.
   */
  responses: unknown[];
  /** Fail this many leading calls before returning responses. */
  failFirst?: number;
  /** Kind of failure `failFirst` produces. */
  failWith?: LlmErrorKind;
  usage?: TokenUsage;
}

export interface FakeLlm extends Llm {
  /** Every call made, in order — assert on what the prompt actually contained. */
  readonly calls: FakeCall[];
}

const DEFAULT_USAGE: TokenUsage = { inputTokens: 100, outputTokens: 50 };

/**
 * An {@link Llm} that answers from a canned list instead of a provider.
 *
 * Responses are returned as-is without schema validation, so a test can hand
 * back a deliberately wrong shape to exercise a caller's own guards.
 */
export function createFakeLlm(options: FakeLlmOptions): FakeLlm {
  const { responses, failFirst = 0, failWith = 'rate_limit', usage = DEFAULT_USAGE } = options;
  if (!responses.length) throw new Error('createFakeLlm needs at least one response.');

  const calls: FakeCall[] = [];
  let answered = 0;

  return {
    calls,
    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<LlmResult<T>> {
      calls.push({ operation: request.operation, prompt: request.prompt });

      if (calls.length <= failFirst) {
        throw new LlmError(failWith, `Fake ${failWith} failure.`, {
          provider: 'fake',
          model: 'fake-model',
        });
      }

      const object = responses[Math.min(answered, responses.length - 1)] as T;
      answered++;
      return { object, providerId: 'gemini', modelId: 'fake-model', usage };
    },
  };
}
