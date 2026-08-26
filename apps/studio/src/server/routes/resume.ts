// The résumé document over HTTP: read it, write it, compile it, look at the PDF.
//
// A PUT goes through parseResume before anything touches disk, so a malformed
// edit is a 400 rather than a broken document, and it re-renders resume.tex the
// way both build paths do — leaving the .tex behind would trip the source guard
// on the next commit.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { checkResume, loadResume, parseResume, writeResumeTex, RESUME_JSON } from '@resume/core';
import { buildPdfScript } from '@resume/cli';
import type { Studio } from '../studio.js';

const CANONICAL_PDF = ['apps', 'web', 'assets', 'resume.pdf'];

// A LaTeX compile that has to pull the TeX Live image can take minutes; one that
// hangs should still end.
const BUILD_TIMEOUT_MS = 15 * 60_000;

// Run the same script `resume build` runs, capturing its output instead of
// inheriting a terminal the browser cannot see.
function compile(): Promise<{ ok: boolean; log: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', buildPdfScript], { windowsHide: true });
    let log = '';
    const collect = (buf: Buffer): void => { log += buf.toString(); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timer = setTimeout(() => child.kill(), BUILD_TIMEOUT_MS);
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, log: log + err.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, log }); });
  });
}

export function resumeRoutes(studio: Studio): Hono {
  const app = new Hono();
  const { root } = studio.cli;

  app.get('/resume', async (c) => {
    try {
      return c.json({ resume: await loadResume(root) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  app.put('/resume', async (c) => {
    let resume;
    try {
      resume = parseResume(await c.req.json());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    await writeFile(join(root, RESUME_JSON), JSON.stringify(resume, null, 2) + '\n');
    await writeResumeTex(root, resume);
    return c.json({ resume });
  });

  app.post('/resume/build', async (c) => {
    const { ok, log } = await compile();
    // The guards are worth running either way: a failed compile leaves the last
    // good PDF in place, and knowing whether that one still passes is the
    // difference between "your edit broke it" and "the toolchain is down".
    const checks = await checkResume({ root });
    return c.json({ ok, log, checks });
  });

  app.get('/resume.pdf', async (c) => {
    const path = join(root, ...CANONICAL_PDF);
    if (!existsSync(path)) return c.json({ error: 'The canonical PDF is not built yet.' }, 404);
    return c.body(await readFile(path), 200, {
      'Content-Type': 'application/pdf',
      // The pane reloads this after every build; a cached copy would show the
      // document as it was before the compile that was just watched finish.
      'Cache-Control': 'no-store',
    });
  });

  return app;
}
