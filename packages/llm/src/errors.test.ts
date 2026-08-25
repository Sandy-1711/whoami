import { describe, expect, it } from 'vitest';
import { APICallError, NoObjectGeneratedError, TypeValidationError, type LanguageModelUsage } from 'ai';
import { LlmError, classifyLlmError } from './errors.js';

const CTX = { provider: 'gemini', model: 'gemini-2.5-flash' };

function apiError(statusCode: number, message = 'boom', isRetryable = false): APICallError {
  return new APICallError({
    message,
    url: 'https://example.test',
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });
}

function noObjectError(finishReason: 'content-filter' | 'stop'): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: 'no object',
    finishReason,
    response: { id: 'r1', timestamp: new Date(0), modelId: CTX.model },
    // Classification reads only finishReason; the full usage shape is noise here.
    usage: {} as LanguageModelUsage,
  });
}

describe('classifyLlmError', () => {
  it('maps 401 and 403 to auth', () => {
    expect(classifyLlmError(apiError(401), CTX).kind).toBe('auth');
    expect(classifyLlmError(apiError(403), CTX).kind).toBe('auth');
  });

  it('maps 429 to rate_limit', () => {
    expect(classifyLlmError(apiError(429), CTX).kind).toBe('rate_limit');
  });

  it('maps 5xx to server', () => {
    expect(classifyLlmError(apiError(500), CTX).kind).toBe('server');
    expect(classifyLlmError(apiError(503), CTX).kind).toBe('server');
  });

  it('keeps the provider message rather than replacing it', () => {
    const err = classifyLlmError(apiError(429, 'Quota exceeded for model X'), CTX);
    expect(err.message).toContain('Quota exceeded for model X');
  });

  it('records the provider, model, and status', () => {
    const err = classifyLlmError(apiError(429), CTX);
    expect(err.provider).toBe('gemini');
    expect(err.model).toBe('gemini-2.5-flash');
    expect(err.status).toBe(429);
  });

  it('treats a safety block as safety, not a schema failure', () => {
    expect(classifyLlmError(noObjectError('content-filter'), CTX).kind).toBe('safety');
  });

  it('treats other missing objects as schema failures', () => {
    expect(classifyLlmError(noObjectError('stop'), CTX).kind).toBe('schema');
  });

  it('maps a type validation failure to schema', () => {
    const err = classifyLlmError(
      new TypeValidationError({ value: {}, cause: new Error('bad shape') }),
      CTX,
    );
    expect(err.kind).toBe('schema');
  });

  it('detects an abort as a timeout', () => {
    const aborted = new Error('aborted');
    aborted.name = 'TimeoutError';
    expect(classifyLlmError(aborted, CTX).kind).toBe('timeout');
  });

  it('detects a timeout wrapped in another error', () => {
    const inner = new Error('aborted');
    inner.name = 'AbortError';
    expect(classifyLlmError(new Error('call failed', { cause: inner }), CTX).kind).toBe('timeout');
  });

  it('falls back to unknown for an unrecognised error', () => {
    const err = classifyLlmError(new Error('something odd'), CTX);
    expect(err.kind).toBe('unknown');
    expect(err.message).toBe('something odd');
  });

  it('passes an already-classified error through unchanged', () => {
    const original = new LlmError('auth', 'no key', CTX);
    expect(classifyLlmError(original, CTX)).toBe(original);
  });
});

describe('LlmError', () => {
  it('marks transient kinds retryable and permanent ones not', () => {
    expect(new LlmError('rate_limit', 'x', CTX).retryable).toBe(true);
    expect(new LlmError('server', 'x', CTX).retryable).toBe(true);
    expect(new LlmError('timeout', 'x', CTX).retryable).toBe(true);
    expect(new LlmError('auth', 'x', CTX).retryable).toBe(false);
    expect(new LlmError('schema', 'x', CTX).retryable).toBe(false);
  });

  it('describes itself with provider, message, and a hint', () => {
    const line = new LlmError('auth', 'no key', CTX).describe();
    expect(line).toContain('gemini/gemini-2.5-flash');
    expect(line).toContain('no key');
    expect(line).toContain('API key');
  });
});
