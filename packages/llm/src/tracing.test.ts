import { ROOT_CONTEXT, TraceFlags, trace, type Context, type SpanContext } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import type { Span } from '@opentelemetry/sdk-trace-base';
import { getTracer, markTraceRoots, startTracing, type TracingConfig } from './tracing.js';

function config(overrides: Partial<TracingConfig> = {}): TracingConfig {
  return { enabled: true, publicKey: 'pk-lf-test', secretKey: 'sk-lf-test', baseUrl: '', ...overrides };
}

describe('startTracing', () => {
  it('stays off when no config is supplied at all', async () => {
    expect(await startTracing()).toBeNull();
  });

  it('stays off when LANGFUSE_ENABLED is unset', async () => {
    expect(await startTracing(config({ enabled: false }))).toBeNull();
  });

  it('stays off when only one of the two keys is set', async () => {
    expect(await startTracing(config({ publicKey: '' }))).toBeNull();
    expect(await startTracing(config({ secretKey: '' }))).toBeNull();
  });
});

function spanContext(overrides: Partial<SpanContext> = {}): SpanContext {
  return {
    traceId: '22222222222222222222222222222222',
    spanId: '1111111111111111',
    traceFlags: TraceFlags.SAMPLED,
    ...overrides,
  };
}

function recordingSpan() {
  const attributes: Record<string, unknown> = {};
  const span = {
    setAttribute: vi.fn((key: string, value: unknown) => {
      attributes[key] = value;
      return span;
    }),
  };
  return { span: span as unknown as Span, attributes };
}

describe('markTraceRoots', () => {
  it('marks a span that starts with no parent', () => {
    const { span, attributes } = recordingSpan();
    markTraceRoots().onStart(span, ROOT_CONTEXT);
    expect(attributes).toEqual({
      'langfuse.internal.as_root': true,
      'langfuse.internal.is_app_root': true,
    });
  });

  it('leaves a span with a parent alone, so only one span per trace is a root', () => {
    const { span, attributes } = recordingSpan();
    const parent: Context = trace.setSpanContext(ROOT_CONTEXT, spanContext());
    markTraceRoots().onStart(span, parent);
    expect(attributes).toEqual({});
  });

  it('marks a span whose parent context is present but invalid', () => {
    const { span, attributes } = recordingSpan();
    const invalid: Context = trace.setSpanContext(
      ROOT_CONTEXT,
      spanContext({ traceId: '0'.repeat(32), spanId: '0'.repeat(16) }),
    );
    markTraceRoots().onStart(span, invalid);
    expect(Object.keys(attributes)).toHaveLength(2);
  });
});

describe('getTracer', () => {
  it('hands out non-recording spans with no provider registered, so an untraced run costs nothing', () => {
    const span = getTracer().startSpan('llm.tailor');
    expect(span.isRecording()).toBe(false);
    span.end();
  });

  it('runs the callback of an active span either way', async () => {
    const seen = await getTracer().startActiveSpan('llm.tailor', async (span) => {
      span.setAttribute('gen_ai.system', 'gemini');
      span.end();
      return 'ran';
    });
    expect(seen).toBe('ran');
  });
});
