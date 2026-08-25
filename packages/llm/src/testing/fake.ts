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

const FAKE_CONTEXT = { provider: 'fake', model: 'fake-model' };

const DEFAULT_USAGE: TokenUsage = { inputTokens: 100, outputTokens: 50 };

/**
 * An {@link Llm} that answers from a canned list instead of a provider.
 *
 * Responses go through the request's schema exactly as the real gateway's do, so
 * defaults are applied and a canned response of the wrong shape raises the same
 * `schema` {@link LlmError} a real model would.
 */
export function createFakeLlm(options: FakeLlmOptions): FakeLlm {
  const { responses, failFirst = 0, failWith = 'rate_limit', usage = DEFAULT_USAGE } = options;
  if (!responses.length) throw new Error('createFakeLlm needs at least one response.');

  const calls: FakeCall[] = [];
  let answered = 0;

  return {
    calls,
    describe() {
      return { providerId: 'gemini' as const, modelId: 'fake-model', label: 'Fake' };
    },

    async generateJson<T>(request: GenerateJsonRequest<T>): Promise<LlmResult<T>> {
      calls.push({ operation: request.operation, prompt: request.prompt });

      if (calls.length <= failFirst) {
        throw new LlmError(failWith, `Fake ${failWith} failure.`, FAKE_CONTEXT);
      }

      const canned = responses[Math.min(answered, responses.length - 1)];
      answered++;

      const parsed = request.schema.safeParse(canned);
      if (!parsed.success) {
        throw new LlmError('schema', parsed.error.message, FAKE_CONTEXT);
      }
      return { object: parsed.data, providerId: 'gemini', modelId: 'fake-model', usage };
    },
  };
}
