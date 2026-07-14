import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditBuild } from './audit.js';
import { writeBuildLock, hashWeights, hashTemplate, BUILD_LOCK_VERSION, type BuildLock } from './lockfile.js';
import { DEFAULT_WEIGHTS } from './relevance.js';
import { outputPaths } from '../naming.js';
import type { OutputPaths } from '../types.js';

const RESUME = '\\documentclass{article}\\begin{document}\\end{document}';

async function setup(overrides: Partial<BuildLock> = {}): Promise<{ root: string; slug: string; paths: OutputPaths }> {
  const root = await mkdtemp(join(tmpdir(), 'audit-'));
  await mkdir(join(root, 'profile'), { recursive: true });
  await writeFile(join(root, 'resume.tex'), RESUME);
  await writeFile(join(root, 'profile', 'facts.json'), JSON.stringify({ identity: { name: 'Sandeep Singh' } }));
  await writeFile(join(root, 'profile', 'evidence.json'), JSON.stringify({
    units: [{ id: 'ev_a', claim: 'a', skills: [], domains: [], provenance: [{ source: 'facts', ref: 'x' }], quality_score: 1, tier: 'normal' }],
  }));
  const paths = outputPaths(root, { company: 'Acme', fullName: 'Sandeep Singh', role: 'AI Engineer' });
  await mkdir(paths.dir, { recursive: true });
  const lock: BuildLock = {
    version: BUILD_LOCK_VERSION, company: 'Acme', role: 'AI Engineer',
    jd_hash: 'jd', weights_hash: hashWeights(DEFAULT_WEIGHTS), template_hash: hashTemplate(RESUME),
    requirement_graph: { must_have: [], nice_to_have: [], ats_keywords: [], seniority: '', domain: '', jd_hash: 'jd' },
    selected: [{ id: 'ev_a', claim: 'a', score: 0.9, anchor: 'exp-aira' }],
    ats_score: { before: 40, after: 70, total: 100 }, coverage_score: 1, guards_pass: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  await writeBuildLock(paths, lock);
  return { root, slug: paths.slug, paths };
}

describe('auditBuild', () => {
  it('passes a clean build with all units still present', async () => {
    const { root, slug } = await setup();
    const r = await auditBuild({ root, slug });
    expect(r.found).toBe(true);
    expect(r.pass).toBe(true);
    expect(r.checks.find((c) => c.name === 'grounding')!.pass).toBe(true);
  });

  it('fails grounding when a selected unit is gone from the store', async () => {
    const { root, slug } = await setup({ selected: [{ id: 'ghost', claim: 'x', score: 0.5, anchor: 'exp-aira' }] });
    const r = await auditBuild({ root, slug });
    expect(r.pass).toBe(false);
    expect(r.checks.find((c) => c.name === 'grounding')!.detail).toMatch(/no longer in the store/);
  });

  it('fails when the recorded guards did not pass', async () => {
    const { root, slug } = await setup({ guards_pass: false });
    const r = await auditBuild({ root, slug });
    expect(r.pass).toBe(false);
  });

  it('flags template drift as a non-critical warning', async () => {
    const { root, slug } = await setup();
    await writeFile(join(root, 'resume.tex'), RESUME + '\n% changed');
    const r = await auditBuild({ root, slug });
    const drift = r.checks.find((c) => c.name === 'template drift')!;
    expect(drift.pass).toBe(false);
    expect(drift.critical).toBe(false);
    expect(r.pass).toBe(true); // drift alone doesn't fail the audit
  });

  it('reports not-found for a missing lockfile', async () => {
    const { root } = await setup();
    const r = await auditBuild({ root, slug: 'nope' });
    expect(r.found).toBe(false);
    expect(r.pass).toBe(false);
  });

  it('runs a live one-page check when a PdfInspector is provided', async () => {
    const { root, slug, paths } = await setup();
    await writeFile(paths.pdf, '%PDF-fake');
    const r = await auditBuild({ root, slug, pdf: { async extract() { return { text: '', totalPages: 2 }; } } });
    const live = r.checks.find((c) => c.name === 'pages (live)')!;
    expect(live.pass).toBe(false);
    expect(r.pass).toBe(false); // live page check is critical
  });
});
