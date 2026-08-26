// The tailored PDFs on disk: list them, and serve one for the preview pane.
//
// Only files under tailored/ are servable. The path arrives from the browser,
// so it is resolved and then checked against that root — a route that reads an
// arbitrary path off the wire is a file-disclosure hole even on localhost.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { listTailoredOutputs } from '@resume/core';
import type { Studio } from '../studio.js';

function insideTailored(root: string, relPath: string): string | null {
  const dir = resolve(join(root, 'tailored'));
  const path = resolve(join(dir, relPath));
  if (path !== dir && !path.startsWith(dir + sep)) return null;
  return path.toLowerCase().endsWith('.pdf') ? path : null;
}

export function outputRoutes(studio: Studio): Hono {
  const app = new Hono();
  const { root } = studio.cli;

  app.get('/outputs', async (c) => {
    const outputs = await listTailoredOutputs(root);
    return c.json({ outputs: outputs.map(({ relPath, mtime }) => ({ relPath, mtime })) });
  });

  app.get('/outputs/:relPath{.+}', async (c) => {
    const relPath = c.req.param('relPath');
    const path = insideTailored(root, relPath);
    if (!path) return c.json({ error: 'Not a tailored PDF.' }, 400);
    if (!existsSync(path)) return c.json({ error: `No such output: ${relPath}` }, 404);
    return c.body(await readFile(path), 200, {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
    });
  });

  return app;
}
