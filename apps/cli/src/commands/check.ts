// `resume check` — run the résumé guards (source structure, and PDF/width when
// a build exists). Thin wrapper over check-resume.ts (run via the tsx loader,
// since node can't execute .ts directly).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Cli } from '../container.js';

export async function runCheck(_cli: Cli, { scope = '' }: { scope?: string } = {}): Promise<void> {
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-resume.ts');
  const args = ['--import', 'tsx', script];
  if (scope) args.push(scope); // '--source' | '--pdf' | '--log'
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Checks failed.');
}
