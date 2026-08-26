// The studio's HTTP surface. Every route lives under /api; everything else is
// the SPA, served by Vite from main.ts.
import { Hono } from 'hono';
import { chatRoutes } from './routes/chat.js';
import { fileRoutes } from './routes/files.js';
import { outputRoutes } from './routes/outputs.js';
import { resumeRoutes } from './routes/resume.js';
import { statusRoutes } from './routes/status.js';
import { threadRoutes } from './routes/threads.js';
import type { Studio } from './studio.js';

export function createApp(studio: Studio): Hono {
  const api = new Hono();
  api.route('/', statusRoutes(studio));
  api.route('/', resumeRoutes(studio));
  api.route('/', outputRoutes(studio));
  api.route('/', threadRoutes(studio));
  api.route('/', fileRoutes(studio));
  api.route('/', chatRoutes(studio));

  // A thrown error must not reach the browser as an empty 500 — the whole point
  // of the studio is that what went wrong is readable without a terminal.
  api.onError((err, c) => c.json({ error: err.message }, 500));

  const app = new Hono();
  app.route('/api', api);
  return app;
}
