// POST /api/files — drop a JD into the studio and get back a path.
//
// It exists because every JD-taking tool accepts a `jdPath`, and pasting a long
// description into a chat box is the worst way to hand one over. The file lands
// in the agent's own workspace, which is already gitignored as machine-local.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { Studio } from '../studio.js';

const MAX_BYTES = 512 * 1024;

// Whatever the browser called it, reduced to something safe to put on disk.
function stem(name: string): string {
  const cleaned = name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (cleaned || 'jd').slice(0, 60).toLowerCase();
}

export function fileRoutes(studio: Studio): Hono {
  const app = new Hono();
  const dir = join(studio.cli.root, '.agent', 'jd');

  app.post('/files', async (c) => {
    const form = await c.req.parseBody().catch(() => null);
    const upload = form?.['file'];
    const name = upload instanceof File ? upload.name : String(form?.['name'] ?? 'jd.txt');
    const text = upload instanceof File ? await upload.text() : String(form?.['text'] ?? '');

    if (!text.trim()) return c.json({ error: 'Nothing to save — send a `file` or a `text` field.' }, 400);
    if (text.length > MAX_BYTES) return c.json({ error: `That is over the ${MAX_BYTES / 1024} KB limit.` }, 413);

    await mkdir(dir, { recursive: true });
    const path = join(dir, `${Date.now()}-${stem(name)}.txt`);
    await writeFile(path, text);
    return c.json({ path, chars: text.length });
  });

  return app;
}
