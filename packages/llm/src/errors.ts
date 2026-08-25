import { APICallError, NoObjectGeneratedError, TypeValidationError } from 'ai';

/** Why a model call failed, in terms a caller can act on. */
export type LlmErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'schema'
  | 'safety'
  | 'server'
  | 'unknown';

/** What the user can do about each kind of failure. */
const HINTS: Record<LlmErrorKind, string> = {
  auth: 'Check the provider API key in .env.',
  rate_limit: 'Quota or rate limit reached — wait, or run again with a different --provider.',
  timeout: 'The model did not respond in time. Retry, or raise LLM_TIMEOUT_MS.',
  schema: 'The model returned data that did not match the expected shape.',
  safety: 'The provider blocked this request on safety grounds.',
  server: 'The provider had a server-side error. Retry shortly.',
  unknown: 'Retry, and check the provider status page if it persists.',
};

const RETRYABLE = new Set<LlmErrorKind>(['rate_limit', 'server', 'timeout']);

export interface LlmErrorContext {
  provider: string;
  model: string;
}

/**
 * A model call failure, classified so callers can react to `kind` and still show
 * the provider's own message. Never replace this with a generic string — the
 * original detail is the part that makes a failure diagnosable.
 */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly provider: string;
  readonly model: string;
  readonly retryable: boolean;
  readonly status?: number;
  /** One actionable line for the person reading the failure. */
  readonly hint: string;

  constructor(
    kind: LlmErrorKind,
    message: string,
    ctx: LlmErrorContext & { status?: number; cause?: unknown },
  ) {
    super(message, { cause: ctx.cause });
    this.name = 'LlmError';
    this.kind = kind;
    this.provider = ctx.provider;
    this.model = ctx.model;
    this.status = ctx.status;
    this.retryable = RETRYABLE.has(kind);
    this.hint = HINTS[kind];
  }

  /** Provider, model, what went wrong, and what to do — one line for a log or a spinner. */
  describe(): string {
    return `${this.provider}/${this.model}: ${this.message} — ${this.hint}`;
  }
}

function kindFromStatus(status: number | undefined): LlmErrorKind | undefined {
  if (status === undefined) return undefined;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return undefined;
}

// AbortSignal.timeout() rejects with a DOMException named TimeoutError; a caller
// cancelling produces AbortError. Providers wrap both, so walk the cause chain.
function isTimeout(err: unknown): boolean {
  for (let cur = err, depth = 0; cur instanceof Error && depth < 5; cur = cur.cause, depth++) {
    if (cur.name === 'TimeoutError' || cur.name === 'AbortError') return true;
  }
  return false;
}

/** Map a provider or AI SDK error onto an {@link LlmError}, preserving its message. */
export function classifyLlmError(err: unknown, ctx: LlmErrorContext): LlmError {
  if (err instanceof LlmError) return err;

  if (isTimeout(err)) {
    return new LlmError('timeout', 'The request timed out.', { ...ctx, cause: err });
  }

  if (APICallError.isInstance(err)) {
    const kind = kindFromStatus(err.statusCode) ?? (err.isRetryable ? 'server' : 'unknown');
    return new LlmError(kind, err.message, { ...ctx, status: err.statusCode, cause: err });
  }

  if (NoObjectGeneratedError.isInstance(err)) {
    const kind = err.finishReason === 'content-filter' ? 'safety' : 'schema';
    const detail = kind === 'safety'
      ? 'The provider blocked the response.'
      : 'The model produced no object matching the schema.';
    return new LlmError(kind, detail, { ...ctx, cause: err });
  }

  if (TypeValidationError.isInstance(err)) {
    return new LlmError('schema', err.message, { ...ctx, cause: err });
  }

  return new LlmError('unknown', err instanceof Error ? err.message : String(err), {
    ...ctx,
    cause: err,
  });
}
