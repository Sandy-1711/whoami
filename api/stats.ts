import type { VercelRequest, VercelResponse } from '@vercel/node';
import { makeRedis } from '../lib/redis.js';

const redis = makeRedis();

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  let views = 0;
  if (redis) {
    try {
      views = Number((await redis.get('resume:views')) ?? 0);
    } catch {
      // ignore — report 0 if the store is unreachable
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ views });
}
