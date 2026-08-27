import { describe, expect, it } from 'vitest';
import { relay, type StreamChunk } from './relay.js';
import { collectingSink } from './sink.js';

// Real chunk shapes from @mastra/core's fullStream. The field names are the
// point of this file: the studio reads them by key, and a rename upstream would
// otherwise show up only as a pane that quietly stopped filling.
async function* stream(...chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) yield chunk;
}

const RENDER_RESULT = {
  company: 'serval',
  role: 'Software Engineer, Agent Systems',
  score: { current: 60, tailored: 88, projected: 84 },
  pdf: 'tailored/serval/Sandeep Singh - Software Engineer, Agent Systems.pdf',
  guardsPass: true,
};

async function run(...chunks: StreamChunk[]) {
  const sink = collectingSink();
  const usage = await relay(stream(...chunks), sink);
  return { events: sink.events, usage };
}

describe('relay', () => {
  it('sends the answer text', async () => {
    const { events } = await run({ type: 'text-delta', payload: { text: 'hello' } });
    expect(events).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('sends reasoning, and skips an empty thought', async () => {
    const { events } = await run(
      { type: 'reasoning-delta', payload: { text: 'weighing it up' } },
      { type: 'reasoning-delta', payload: {} },
    );
    expect(events).toEqual([{ type: 'reasoning', text: 'weighing it up' }]);
  });

  it('emits an artifact for the PDF a render named', async () => {
    const { events } = await run({
      type: 'tool-result',
      payload: { toolCallId: 'c1', toolName: 'tailor_render', result: RENDER_RESULT },
    });
    expect(events).toContainEqual({
      type: 'artifact',
      id: 'c1',
      artifact: {
        relPath: 'serval/Sandeep Singh - Software Engineer, Agent Systems.pdf',
        tool: 'tailor_render',
        score: { before: 60, after: 88 },
        guardsPass: true,
      },
    });
  });

  it('keys the artifact to the call that produced it, so the card lands in the right turn', async () => {
    const { events } = await run(
      { type: 'tool-call', payload: { toolCallId: 'c1', toolName: 'tailor_render', args: {} } },
      { type: 'tool-result', payload: { toolCallId: 'c1', toolName: 'tailor_render', result: RENDER_RESULT } },
    );
    const artifact = events.find((e) => e.type === 'artifact');
    expect(artifact).toMatchObject({ id: 'c1' });
  });

  it('sends the tool result before the artifact it carried', async () => {
    const { events } = await run({
      type: 'tool-result',
      payload: { toolCallId: 'c1', toolName: 'tailor_render', result: RENDER_RESULT },
    });
    expect(events.map((e) => e.type)).toEqual(['tool-result', 'artifact']);
  });

  it('leaves the result payload on the server', async () => {
    const { events } = await run({
      type: 'tool-result',
      payload: { toolCallId: 'c1', toolName: 'tailor_render', result: RENDER_RESULT },
    });
    expect(JSON.stringify(events)).not.toContain('projected');
  });

  it('emits nothing extra for a tool that wrote no file', async () => {
    const { events } = await run({
      type: 'tool-result',
      payload: { toolCallId: 'c1', toolName: 'score_jd', result: { score: { current: 60, max: 8 } } },
    });
    expect(events.map((e) => e.type)).toEqual(['tool-result']);
  });

  it('times a call from its tool-call to its tool-result', async () => {
    const { events } = await run(
      { type: 'tool-call', payload: { toolCallId: 'c1', toolName: 'score_jd', args: {} } },
      { type: 'tool-result', payload: { toolCallId: 'c1', toolName: 'score_jd', result: {} } },
    );
    const result = events.find((e) => e.type === 'tool-result');
    expect(result).toMatchObject({ name: 'score_jd', isError: false });
    expect((result as { ms: number }).ms).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the tool name when a call carries no id', async () => {
    const { events } = await run({
      type: 'tool-result',
      payload: { toolName: 'score_jd', result: {} },
    });
    expect(events[0]).toMatchObject({ id: 'score_jd' });
  });

  it('reads usage off the finish chunk', async () => {
    const { usage } = await run({
      type: 'finish',
      payload: { output: { usage: { inputTokens: 8508, outputTokens: 341 } } },
    });
    expect(usage).toEqual({ inputTokens: 8508, outputTokens: 341 });
  });

  it('reports zero usage when the stream never finished', async () => {
    const { usage } = await run({ type: 'text-delta', payload: { text: 'partial' } });
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('unwraps an error to its message', async () => {
    const { events } = await run({
      type: 'error',
      payload: { error: { message: 'rate limited' } },
    });
    expect(events).toEqual([{ type: 'error', message: 'rate limited' }]);
  });

  it('ignores a chunk type it has no use for', async () => {
    const { events } = await run({ type: 'step-start', payload: {} });
    expect(events).toEqual([]);
  });
});
