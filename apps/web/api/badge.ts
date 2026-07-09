import type { VercelRequest, VercelResponse } from '@vercel/node';
import { makeViewCounter } from '../lib/view-counter.js';


// Powers a live shields.io "endpoint" badge:
// https://img.shields.io/endpoint?url=https://<project>.vercel.app/api/badge
export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const views = await makeViewCounter().get('resume:views');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    schemaVersion: 1,
    label: 'resume views',
    message: String(views),
    color: 'blue',
  });
}
