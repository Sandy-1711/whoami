import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkResume } from './resume.js';

// A minimal, structurally-sound resume.tex so the source guard passes.
const GOOD_TEX = String.raw`\documentclass{article}
\begin{document}
\href{mailto:me@example.com}{me@example.com} linkedin github
\section{Experience}
\section{Projects}
\section{Technical Skills}
\section{Education}
\end{document}`;

describe('checkResume', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'checkresume-'));
    await writeFile(join(root, 'resume.tex'), GOOD_TEX);
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it('runs all guards by default, skipping unbuilt PDF/width', async () => {
    const r = await checkResume({ root });
    expect(r.source.ran).toBe(true);
    expect(r.source.problems).toEqual([]);
    expect(r.pdf.skipped).toBe(true);
    expect(r.width.skipped).toBe(true);
    expect(r.pass).toBe(true);
  });

  it('scopes to source only when asked', async () => {
    const r = await checkResume({ root, scope: { source: true } });
    expect(r.source.ran).toBe(true);
    expect(r.pdf.ran).toBe(false);
    expect(r.width.ran).toBe(false);
  });

  it('fails when PDF/width are explicitly requested but not built', async () => {
    // Core treats the guards independently; the --pdf→width coupling is a CLI
    // convenience, so request both here.
    const r = await checkResume({ root, scope: { pdf: true, width: true } });
    expect(r.pass).toBe(false);
    expect(r.pdf.ran).toBe(true);
    expect(r.pdf.problems[0]).toMatch(/not found/i);
    expect(r.width.ran).toBe(true);
    expect(r.width.problems[0]).toMatch(/not found/i);
  });

  it('reports source problems from a broken résumé', async () => {
    const broken = await mkdtemp(join(tmpdir(), 'checkresume-bad-'));
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, 'resume.tex'), '\\documentclass{article}\n\\begin{document}\n\\end{document}');
    const r = await checkResume({ root: broken, scope: { source: true } });
    expect(r.pass).toBe(false);
    expect(r.source.problems.length).toBeGreaterThan(0);
    await rm(broken, { recursive: true, force: true });
  });
});
