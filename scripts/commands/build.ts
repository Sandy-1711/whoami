// `resume build` — compile the canonical resume.tex → assets/resume.pdf,
// mirroring CI. Thin wrapper over scripts/build-pdf.ts (run via the tsx loader,
// since node can't execute .ts directly).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from '../lib/root.js';

export async function runBuild(): Promise<void> {
  const r = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts', 'build-pdf.ts')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Build failed.');
}
