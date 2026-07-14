#!/usr/bin/env node
// Résumé structure checker — the CLI face of core's checkResume(). Renders the
// guard outcomes and sets the exit code, so it works as a CI gate and a
// pre-commit hook.
//
//   tsx check-resume.ts            # source + PDF + width (PDF/width skipped if absent)
//   tsx check-resume.ts --source   # source only (used by the git hook)
//   tsx check-resume.ts --pdf       # PDF (+ width); fails if the PDF is missing
//   tsx check-resume.ts --log       # width only
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkResume, type CheckScope, type GuardOutcome } from '@resume/core';

// apps/cli/src/ -> ../../../ is the monorepo root (where resume.tex lives).
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const args = new Set(process.argv.slice(2));
const onlyFlags = args.has('--source') || args.has('--pdf') || args.has('--log');
// --pdf pulls the width guard along, since overflow is a property of that render.
const scope: CheckScope | undefined = onlyFlags
  ? { source: args.has('--source'), pdf: args.has('--pdf'), width: args.has('--log') || args.has('--pdf') }
  : undefined;

async function contactEmail(): Promise<string | undefined> {
  try {
    const facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
    return facts?.identity?.email;
  } catch { return undefined; }
}

function render(title: string, g: GuardOutcome): void {
  if (g.skipped) { console.log(`• ${title}: skipped (artifact not built yet)`); return; }
  if (!g.ran) return;
  if (g.problems.length === 0) { console.log(`✓ ${title}: passed`); return; }
  console.error(`✗ ${title}: ${g.problems.length} problem(s)`);
  for (const p of g.problems) console.error(`    - ${p}`);
}

const result = await checkResume({ root, contactEmail: await contactEmail(), scope });
render('Source structure (resume.tex)', result.source);
render('PDF structure (assets/resume.pdf)', result.pdf);
render('Width (resume.log)', result.width);

if (!result.pass) {
  console.error('\nResume structure check FAILED.');
  process.exit(1);
}
console.log('\nResume structure check passed.');
