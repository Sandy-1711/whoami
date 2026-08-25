import { describe, expect, it } from 'vitest';
import { getTracer, startTracing, type TracingConfig } from './tracing.js';

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
