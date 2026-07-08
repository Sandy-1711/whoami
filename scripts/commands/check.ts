// `resume check` — run the résumé guards (source structure, and PDF/width when
// a build exists). Thin wrapper over scripts/check-resume.ts (run via the tsx
// loader, since node can't execute .ts directly).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from '../lib/root.js';

export async function runCheck({ scope = '' }: { scope?: string } = {}): Promise<void> {
  const args = ['--import', 'tsx', join(root, 'scripts', 'check-resume.ts')];
  if (scope) args.push(scope); // '--source' | '--pdf' | '--log'
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Checks failed.');
}
