// `resume build` — compile the canonical resume.tex → apps/web/assets/resume.pdf,
// mirroring CI. Thin wrapper over build-pdf.ts (run via the tsx loader, since
// node can't execute .ts directly).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Cli } from '../container.js';

export async function runBuild(_cli: Cli): Promise<void> {
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'build-pdf.ts');
  const r = spawnSync(process.execPath, ['--import', 'tsx', script], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Build failed.');
}
