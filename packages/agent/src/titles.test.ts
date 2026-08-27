import { describe, expect, it } from 'vitest';
import { companyTitle, nameThread, requestTitle, type ThreadStore } from './titles.js';

// A store that remembers the last write, which is the whole observable effect.
function fakeStore(thread: { title?: string | null; metadata?: Record<string, unknown> } | null) {
  const writes: { id: string; title: string; metadata: Record<string, unknown> }[] = [];
  const store: ThreadStore = {
    getThreadById: async () => thread,
    updateThread: async (args) => { writes.push(args); return args; },
  };
  return { store, writes };
}

describe('companyTitle', () => {
  it('names the company and what was done for it', () => {
    expect(companyTitle([{ name: 'tailor_plan', args: { company: 'Serval' } }])).toBe('Serval — résumé');
  });

  it('distinguishes the kinds of work on one company', () => {
    expect(companyTitle([{ name: 'outreach_message', args: { company: 'Serval' } }])).toBe('Serval — outreach');
    expect(companyTitle([{ name: 'draft_application_email', args: { company: 'Serval' } }])).toBe('Serval — email');
  });

  it('takes the last company, since a thread that moved on is about where it moved to', () => {
    expect(companyTitle([
      { name: 'tailor_plan', args: { company: 'Serval' } },
      { name: 'tailor_plan', args: { company: 'Acme' } },
    ])).toBe('Acme — résumé');
  });

  it('ignores a company passed as a filter rather than as the subject', () => {
    expect(companyTitle([{ name: 'list_outputs', args: { company: 'Serval' } }])).toBeUndefined();
  });

  it('ignores a call that named no company', () => {
    expect(companyTitle([{ name: 'score_jd', args: { jdPath: 'jd.txt' } }])).toBeUndefined();
    expect(companyTitle([{ name: 'tailor_plan', args: { company: '  ' } }])).toBeUndefined();
    expect(companyTitle([{ name: 'tailor_plan', args: null }])).toBeUndefined();
  });
});

describe('requestTitle', () => {
  it('is the opening line of what was asked', () => {
    expect(requestTitle('Add the MCP server to my summary')).toBe('Add the MCP server to my summary');
  });

  it('drops the path a JD attachment appends', () => {
    expect(requestTitle('Score this for me\n\nThe job description is at: .agent/jd/1-jd.txt'))
      .toBe('Score this for me');
  });

  it('clips a request too long to read in a list', () => {
    const title = requestTitle('x'.repeat(200));
    expect(title).toHaveLength(60);
    expect(title.endsWith('…')).toBe(true);
  });

  it('says something rather than nothing for an empty message', () => {
    expect(requestTitle('   ')).toBe('untitled');
  });
});

describe('nameThread', () => {
  it('titles a new thread after the request that opened it', async () => {
    const { store, writes } = fakeStore({ title: null });
    await nameThread(store, 't1', { message: 'What should I apply to?', calls: [] });
    expect(writes).toEqual([{ id: 't1', title: 'What should I apply to?', metadata: {} }]);
  });

  it('leaves a title that already says something alone', async () => {
    const { store, writes } = fakeStore({ title: 'Serval — résumé' });
    await nameThread(store, 't1', { message: 'and now the email', calls: [] });
    expect(writes).toEqual([]);
  });

  it('renames over the fallback once a call reaches a company', async () => {
    const { store, writes } = fakeStore({ title: 'Score this for me' });
    await nameThread(store, 't1', {
      message: 'Score this for me',
      calls: [{ name: 'tailor_render', args: { company: 'Serval' } }],
    });
    expect(writes[0]).toMatchObject({ title: 'Serval — résumé' });
  });

  it('keeps the metadata it found, rather than clearing it to write a title', async () => {
    const { store, writes } = fakeStore({ title: null, metadata: { workingMemory: 'kept' } });
    await nameThread(store, 't1', { message: 'hello', calls: [] });
    expect(writes[0]?.metadata).toEqual({ workingMemory: 'kept' });
  });

  it('writes nothing when the title would not change', async () => {
    const { store, writes } = fakeStore({ title: 'Serval — résumé' });
    await nameThread(store, 't1', {
      message: 'again',
      calls: [{ name: 'tailor_plan', args: { company: 'Serval' } }],
    });
    expect(writes).toEqual([]);
  });

  it('does nothing for a thread the store does not have', async () => {
    const { store, writes } = fakeStore(null);
    await nameThread(store, 'gone', { message: 'hello', calls: [] });
    expect(writes).toEqual([]);
  });

  it('swallows a store that will not answer, rather than failing the turn', async () => {
    const store: ThreadStore = {
      getThreadById: async () => { throw new Error('libSQL is busy'); },
      updateThread: async () => ({}),
    };
    await expect(nameThread(store, 't1', { message: 'hello', calls: [] })).resolves.toBeUndefined();
  });
});
