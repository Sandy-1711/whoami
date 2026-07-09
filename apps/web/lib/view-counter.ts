// ViewCounter — the port the API handlers depend on instead of talking to Redis
// directly. A Redis-backed adapter is used when a store is configured; otherwise
// a no-op keeps the endpoints working (and counting nothing) with no branching
// at the call site. Failures are swallowed so serving the PDF never depends on
// the counter.
import { makeRedis } from './redis.js';

export interface ViewCounter {
  increment(key: string): Promise<void>;
  get(key: string): Promise<number>;
}

class RedisViewCounter implements ViewCounter {
  constructor(private readonly redis: NonNullable<ReturnType<typeof makeRedis>>) {}

  async increment(key: string): Promise<void> {
    try { await this.redis.incr(key); } catch { /* ignore counter failures */ }
  }

  async get(key: string): Promise<number> {
    try { return Number((await this.redis.get(key)) ?? 0); } catch { return 0; }
  }
}

class NoopViewCounter implements ViewCounter {
  async increment(): Promise<void> { /* no store configured */ }
  async get(): Promise<number> { return 0; }
}

export function makeViewCounter(): ViewCounter {
  const redis = makeRedis();
  return redis ? new RedisViewCounter(redis) : new NoopViewCounter();
}
