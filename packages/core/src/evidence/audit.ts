// Build audit (architecture Layer 7) — replay a tailored/<slug>/build.lock.json
// to prove the build is still trustworthy before you submit it:
//   - grounding: every selected evidence unit still exists in the store,
//   - guards: the build's page/width guards passed (recorded), and, if a
//     PdfInspector is supplied, the tailored PDF is STILL one page,
//   - drift (informational): whether resume.tex or weights.json changed since the
//     build, which would mean a fresh tailor could differ.
// Deterministic + dependency-light so `resume audit` runs without a TeX toolchain.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Facts } from '../types.js';
import type { PdfInspector } from '../ports/latex.js';
import { outputPaths } from '../naming.js';
import { readEvidence } from './store.js';
import { readWeights } from './relevance.js';
import { readBuildLock, buildLockPath, hashWeights, hashTemplate } from './lockfile.js';

export interface AuditCheck {
  name: string;
  pass: boolean;
  critical: boolean; // critical failures fail the audit; non-critical are warnings
  detail: string;
}

export interface AuditReport {
  slug: string;
  lockPath: string;
  found: boolean;
  checks: AuditCheck[];
  pass: boolean;
}

export async function auditBuild(input: {
  root: string;
  slug: string;
  pdf?: PdfInspector; // optional live one-page re-check of the tailored PDF
}): Promise<AuditReport> {
  const { root, slug, pdf } = input;
  const lockPath = join(root, 'tailored', slug, 'build.lock.json');
  const lock = await readBuildLock(lockPath);
  if (!lock) {
    return { slug, lockPath, found: false, pass: false, checks: [{ name: 'lockfile', pass: false, critical: true, detail: `No build.lock.json for "${slug}" (run a --coverage tailor first).` }] };
  }

  const checks: AuditCheck[] = [];

  // Grounding — every selected unit still in the store.
  const store = await readEvidence(root);
  const ids = new Set(store.units.map((u) => u.id));
  const missing = lock.selected.filter((u) => !ids.has(u.id));
  checks.push({
    name: 'grounding',
    critical: true,
    pass: missing.length === 0,
    detail: missing.length ? `${missing.length} selected unit(s) no longer in the store: ${missing.map((m) => m.id).join(', ')}.` : `all ${lock.selected.length} selected units present in the store.`,
  });

  // Recorded guards.
  checks.push({
    name: 'guards (recorded)',
    critical: true,
    pass: lock.guards_pass,
    detail: lock.guards_pass ? 'page/width guards passed at build time.' : 'guards FAILED at build time — this build was not ship-ready.',
  });

  // Live one-page re-check, if a PdfInspector is available and the PDF exists.
  if (pdf) {
    const facts = await readJson<Facts>(join(root, 'profile', 'facts.json'));
    const paths = outputPaths(root, { company: lock.company, fullName: facts?.identity?.name || 'Sandeep Singh', role: lock.role });
    if (existsSync(paths.pdf)) {
      try {
        const { totalPages } = await pdf.extract(paths.pdf);
        checks.push({ name: 'pages (live)', critical: true, pass: totalPages === 1, detail: totalPages === 1 ? 'tailored PDF is one page.' : `tailored PDF is now ${totalPages} pages.` });
      } catch {
        checks.push({ name: 'pages (live)', critical: false, pass: false, detail: 'could not read the tailored PDF.' });
      }
    } else {
      checks.push({ name: 'pages (live)', critical: false, pass: false, detail: 'tailored PDF not found on disk (re-render to re-verify).' });
    }
  }

  // Drift (informational) — resume.tex / weights changed since the build.
  const resumeTex = await readText(join(root, 'resume.tex'));
  checks.push({
    name: 'template drift',
    critical: false,
    pass: resumeTex !== null && hashTemplate(resumeTex) === lock.template_hash,
    detail: resumeTex === null ? 'resume.tex missing.' : hashTemplate(resumeTex) === lock.template_hash ? 'resume.tex unchanged since build.' : 'resume.tex changed since build — a fresh tailor may differ.',
  });
  const weights = await readWeights(root);
  checks.push({
    name: 'weights drift',
    critical: false,
    pass: hashWeights(weights) === lock.weights_hash,
    detail: hashWeights(weights) === lock.weights_hash ? 'weights unchanged since build.' : 'weights.json changed since build — selection may differ now.',
  });

  const pass = checks.filter((c) => c.critical).every((c) => c.pass);
  return { slug, lockPath, found: true, checks, pass };
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return null; }
}
async function readText(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}
