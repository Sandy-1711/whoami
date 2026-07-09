import type { VercelRequest, VercelResponse } from '@vercel/node';
import { makeViewCounter } from '../lib/view-counter.js';

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const views = await makeViewCounter().get('resume:views');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ views });
}
