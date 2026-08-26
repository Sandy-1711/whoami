import { describe, expect, it } from 'vitest';
import type { UserAnswer } from '@resume/agent';
import { browserAsk, browserConfirm } from './gates.js';
import { PendingRequests } from './pending.js';
import { collectingSink } from './sink.js';

const request = { tool: 'send_application_email', action: 'mail a saved draft', params: { to: 'a@b.c' } };

describe('browserConfirm', () => {
  it('puts the resolved call on the wire and returns the browser’s verdict', async () => {
    const pending = new PendingRequests<boolean>();
    const sink = collectingSink();
    const approved = browserConfirm(pending, sink)(request);

    const event = sink.events[0];
    expect(event).toMatchObject({ type: 'confirm', request });

    pending.settle((event as { id: string }).id, true);
    await expect(approved).resolves.toBe(true);
  });

  it('refuses when the stream is abandoned', async () => {
    const pending = new PendingRequests<boolean>();
    const approved = browserConfirm(pending, collectingSink())(request);

    pending.abandon(false);
    await expect(approved).resolves.toBe(false);
  });
});

describe('browserAsk', () => {
  const questions = [{ id: 'tone', question: 'How formal?', options: ['warm', 'plain'] }];

  it('returns the answers the browser posts back', async () => {
    const pending = new PendingRequests<UserAnswer[] | null>();
    const sink = collectingSink();
    const answered = browserAsk(pending, sink)(questions);

    const event = sink.events[0];
    expect(event).toMatchObject({ type: 'ask', questions });

    pending.settle((event as { id: string }).id, [{ id: 'tone', answer: 'plain' }]);
    await expect(answered).resolves.toEqual([{ id: 'tone', answer: 'plain' }]);
  });

  it('throws rather than handing back blanks nobody chose', async () => {
    const pending = new PendingRequests<UserAnswer[] | null>();
    const answered = browserAsk(pending, collectingSink())(questions);

    pending.abandon(null);
    await expect(answered).rejects.toThrow(/unanswered/i);
  });
});
