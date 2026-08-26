// `resume build` — render profile/resume.json to resume.tex and compile it to
// apps/web/assets/resume.pdf, mirroring CI. Thin wrapper over build-pdf.ts (run
// via the tsx loader, since node can't execute .ts directly).
import { spawnSync } from 'node:child_process';
import { buildPdfScript } from '../paths.js';
import type { Cli } from '../container.js';

export async function runBuild(_cli: Cli): Promise<void> {
  const r = spawnSync(process.execPath, ['--import', 'tsx', buildPdfScript], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Build failed.');
}
