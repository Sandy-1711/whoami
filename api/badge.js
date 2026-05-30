import { Redis } from '@upstash/redis';

let redis = null;
try {
  redis = Redis.fromEnv();
} catch {
  // not configured yet
}

// Powers a live shields.io "endpoint" badge:
// https://img.shields.io/endpoint?url=https://<project>.vercel.app/api/badge
export default async function handler(req, res) {
  let views = 0;
  if (redis) {
    try {
      views = Number((await redis.get('resume:views')) ?? 0);
    } catch {
      // ignore — show 0 if the store is unreachable
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    schemaVersion: 1,
    label: 'resume views',
    message: String(views),
    color: 'blue',
  });
}
