// `resume check` — run the résumé guards (source structure, and PDF/width when
// a build exists). Thin wrapper over scripts/check-resume.js.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root } from '../lib/root.js';

export async function runCheck({ scope = '' } = {}) {
  const args = [join(root, 'scripts', 'check-resume.js')];
  if (scope) args.push(scope); // '--source' | '--pdf' | '--log'
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Checks failed.');
}
