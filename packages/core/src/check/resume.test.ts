import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { appendFile, mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadResume, writeResumeTex } from '../resume/store.js';
import { checkResume } from './resume.js';

// A minimal résumé that renders to a structurally-sound resume.tex, so the
// source guard passes — every required section has an entry.
const RESUME = {
  name: 'Sandeep Singh',
  subtitle: ['AI Engineer'],
  contacts: [
    '[me@example.com](mailto:me@example.com)',
    '[linkedin.com/in/x](https://linkedin.com/in/x)',
    '[github.com/x](https://github.com/x)',
  ],
  summary: 'Builds agentic LLM systems.',
  experience: [{ id: 'acme', org: 'Acme AI', role: 'Engineer', bullets: [{ id: 'acme-1', text: 'Shipped it.' }] }],
  projects: [{ id: 'sdk', name: 'sdk', bullets: [{ id: 'sdk-1', text: 'One interface.' }] }],
  skills: [{ id: 'languages', label: 'Languages', items: ['TypeScript'] }],
  education: [{ id: 'mmmut', school: 'MMMUT', degree: 'B.Tech' }],
};

async function writeResume(root: string): Promise<void> {
  await mkdir(join(root, 'profile'), { recursive: true });
  await writeFile(join(root, 'profile', 'resume.json'), JSON.stringify(RESUME));
  await writeResumeTex(root, await loadResume(root));
}

describe('checkResume', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'checkresume-'));
    await writeResume(root);
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

  it('reports a resume.tex that is no longer what the document renders', async () => {
    const stale = await mkdtemp(join(tmpdir(), 'checkresume-stale-'));
    await writeResume(stale);
    // Structurally fine, so only the freshness problem can fail it.
    await appendFile(join(stale, 'resume.tex'), '% edited by hand\n');
    const r = await checkResume({ root: stale, scope: { source: true } });
    expect(r.pass).toBe(false);
    expect(r.source.problems.join(' ')).toMatch(/not what profile\/resume\.json renders to/);
    await rm(stale, { recursive: true, force: true });
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
