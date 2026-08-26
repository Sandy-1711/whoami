import { describe, expect, it, vi } from 'vitest';
import { PendingRequests } from './pending.js';

describe('PendingRequests', () => {
  it('resolves with the answer the id is settled with', async () => {
    const pending = new PendingRequests<boolean>();
    let handed = '';
    const answered = pending.put({ timeoutMs: 1000, fallback: false, emit: (id) => { handed = id; } });

    expect(pending.settle(handed, true)).toBe(true);
    await expect(answered).resolves.toBe(true);
  });

  it('falls back when nobody answers in time', async () => {
    vi.useFakeTimers();
    try {
      const pending = new PendingRequests<boolean>();
      const answered = pending.put({ timeoutMs: 50, fallback: false, emit: () => {} });
      await vi.advanceTimersByTimeAsync(50);
      await expect(answered).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a second answer for the same id', async () => {
    const pending = new PendingRequests<boolean>();
    let handed = '';
    const answered = pending.put({ timeoutMs: 1000, fallback: false, emit: (id) => { handed = id; } });

    pending.settle(handed, true);
    expect(pending.settle(handed, false)).toBe(false);
    await expect(answered).resolves.toBe(true);
  });

  it('reports an unknown id rather than throwing', () => {
    expect(new PendingRequests<boolean>().settle('nothing-was-parked-here', true)).toBe(false);
  });

  it('settles with the fallback when emitting the id fails', async () => {
    const pending = new PendingRequests<boolean>();
    const answered = pending.put({
      timeoutMs: 1000,
      fallback: false,
      emit: () => { throw new Error('the stream is gone'); },
    });

    await expect(answered).resolves.toBe(false);
    expect(pending.outstanding).toBe(0);
  });

  it('abandons every open request at once', async () => {
    const pending = new PendingRequests<string | null>();
    const first = pending.put({ timeoutMs: 1000, fallback: null, emit: () => {} });
    const second = pending.put({ timeoutMs: 1000, fallback: null, emit: () => {} });
    expect(pending.outstanding).toBe(2);

    pending.abandon(null);

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    expect(pending.outstanding).toBe(0);
  });
});
