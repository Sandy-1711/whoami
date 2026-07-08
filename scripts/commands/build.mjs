// `resume build` — compile the canonical resume.tex → assets/resume.pdf,
// mirroring CI. Thin wrapper over scripts/build-pdf.mjs.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from '../lib/root.js';

export async function runBuild() {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'build-pdf.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Build failed.');
}
