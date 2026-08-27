import { describe, expect, it } from 'vitest';
import { hasContent, restoreMessage, type StoredMessage } from './transcript.js';

// Real part shapes, read out of .agent/memory.db rather than imagined. The field
// names are the point of this file: `reasoning` carries the thought under a key
// of its own, and a call is wrapped one level down in `toolInvocation`.
const AT = new Date('2026-08-27T10:59:30.332Z');

function stored(role: string, ...parts: unknown[]): StoredMessage {
  return { id: 'm1', role, createdAt: AT, content: { parts } };
}

const RENDER_CALL = {
  type: 'tool-invocation',
  toolInvocation: {
    state: 'result',
    toolCallId: 'usmeFnUL56AQQ2oU',
    toolName: 'tailor_render',
    args: { company: 'Serval' },
    result: {
      company: 'serval',
      score: { current: 60, tailored: 70, projected: 80 },
      pdf: 'tailored/serval/Sandeep Singh - Software Engineer, Agent Systems.pdf',
      guardsPass: true,
    },
  },
};

describe('restoreMessage', () => {
  it('joins the text parts of a message', () => {
    const message = restoreMessage(stored('assistant',
      { type: 'text', text: 'Tailored it' },
      { type: 'text', text: ' for Serval.' },
    ));
    expect(message.text).toBe('Tailored it for Serval.');
  });

  it('restores thinking, as paragraphs rather than run together', () => {
    const message = restoreMessage(stored('assistant',
      { type: 'reasoning', reasoning: '**Defining Resume Tailoring**', details: [] },
      { type: 'step-start' },
      { type: 'reasoning', reasoning: '**Rendering the PDF**', details: [] },
    ));
    expect(message.reasoning).toBe('**Defining Resume Tailoring**\n\n**Rendering the PDF**');
  });

  it('skips a thought that is empty', () => {
    const message = restoreMessage(stored('assistant', { type: 'reasoning', reasoning: '  ' }));
    expect(message.reasoning).toBe('');
  });

  it('restores a call with the arguments it ran with', () => {
    const message = restoreMessage(stored('assistant', RENDER_CALL));
    expect(message.calls).toEqual([
      { id: 'usmeFnUL56AQQ2oU', name: 'tailor_render', args: { company: 'Serval' } },
    ]);
  });

  it('gives a restored call no duration to display', () => {
    const message = restoreMessage(stored('assistant', RENDER_CALL));
    expect(Object.keys(message.calls[0]!)).toEqual(['id', 'name', 'args']);
  });

  it('recovers the card for a file the stored result named', () => {
    const message = restoreMessage(stored('assistant', RENDER_CALL));
    expect(message.artifacts).toEqual([{
      relPath: 'serval/Sandeep Singh - Software Engineer, Agent Systems.pdf',
      tool: 'tailor_render',
      score: { before: 60, after: 70 },
      guardsPass: true,
    }]);
  });

  it('leaves the stored result itself on the server', () => {
    const message = restoreMessage(stored('assistant', RENDER_CALL));
    expect(JSON.stringify(message)).not.toContain('projected');
  });

  it('falls back to the tool name when a stored call has no id', () => {
    const message = restoreMessage(stored('assistant', {
      type: 'tool-invocation',
      toolInvocation: { toolName: 'score_jd', args: {} },
    }));
    expect(message.calls[0]).toMatchObject({ id: 'score_jd' });
  });

  it('drops an invocation naming no tool rather than drawing a blank row', () => {
    const message = restoreMessage(stored('assistant', { type: 'tool-invocation', toolInvocation: {} }));
    expect(message.calls).toEqual([]);
  });

  it('reads a message whose parts are missing entirely', () => {
    const message = restoreMessage({ id: 'm1', role: 'user', createdAt: AT });
    expect(message).toMatchObject({ text: '', reasoning: '', calls: [], artifacts: [] });
  });
});

describe('hasContent', () => {
  const of = (...parts: unknown[]) => hasContent(restoreMessage(stored('assistant', ...parts)));

  it('keeps a message that only made a call', () => {
    expect(of(RENDER_CALL)).toBe(true);
  });

  it('keeps a message that only thought', () => {
    expect(of({ type: 'reasoning', reasoning: 'weighing it up' })).toBe(true);
  });

  it('drops a message with nothing but a step marker', () => {
    expect(of({ type: 'step-start' })).toBe(false);
  });
});
