import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLlm } from './generate.js';
import type { LlmError } from './errors.js';
import type { LanguageModel } from './models.js';

const { resolveModel } = vi.hoisted(() => ({ resolveModel: vi.fn() }));
vi.mock('./models.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./models.js')>()),
  resolveModel,
}));

const exporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
);

const SCHEMA = z.object({ summary: z.string() });

// Enough of a provider reply for `generateObject` to parse and validate.
function replyWith(object: unknown): LanguageModel {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(object) }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 34, text: 34, reasoning: 0 },
      },
      warnings: [],
    },
  }) as unknown as LanguageModel;
}

function useModel(model: LanguageModel): void {
  resolveModel.mockReturnValue({
    providerId: 'gemini',
    modelId: 'gemini-2.5-flash',
    label: 'Gemini',
    model,
  });
}

function only(): ReadableSpan {
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  return spans[0]!;
}

function call() {
  return createLlm({ provider: '', keys: { gemini: 'g' }, models: {} }).generateJson({
    prompt: 'Tailor this résumé.',
    schema: SCHEMA,
    operation: 'tailor',
  });
}

beforeEach(() => {
  exporter.reset();
  resolveModel.mockReset();
});

describe('generateJson tracing', () => {
  it('names the span after the operation the caller passed', async () => {
    useModel(replyWith({ summary: 'ok' }));
    await call();
    expect(only().name).toBe('llm.tailor');
  });

  it('tags the span so Langfuse reads it as a model call', async () => {
    useModel(replyWith({ summary: 'ok' }));
    await call();
    expect(only().attributes).toMatchObject({
      'gen_ai.operation.name': 'generate_content',
      'gen_ai.system': 'gemini',
      'gen_ai.request.model': 'gemini-2.5-flash',
      'langfuse.observation.type': 'generation',
      'langfuse.trace.name': 'tailor',
    });
  });

  it('records the prompt, the reply, and what the call cost in tokens', async () => {
    useModel(replyWith({ summary: 'ok' }));
    await call();
    expect(only().attributes).toMatchObject({
      'langfuse.observation.input': 'Tailor this résumé.',
      'langfuse.observation.output': '{"summary":"ok"}',
      'gen_ai.usage.input_tokens': 120,
      'gen_ai.usage.output_tokens': 34,
    });
  });

  it('ends the span with the classified failure rather than swallowing it', async () => {
    useModel(replyWith({ wrong: 'shape' }));
    const err = (await call().catch((e: unknown) => e)) as LlmError;

    expect(err.kind).toBe('schema');
    const span = only();
    expect(span.status.code).toBe(2);
    expect(span.attributes['error.type']).toBe('schema');
    expect(span.attributes['langfuse.observation.level']).toBe('ERROR');
  });
});
