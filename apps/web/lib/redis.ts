import { Redis } from '@upstash/redis';

// Returns a Redis client, or null if no store is configured yet.
// Accepts either env-var naming so it works whichever way you connect the
// store in Vercel: Upstash integration (UPSTASH_REDIS_REST_*) or Vercel KV
// (KV_REST_API_*).
export function makeRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}
