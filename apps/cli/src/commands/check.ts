// `resume check` — run the résumé guards (source structure, and PDF/width when
// a build exists). Thin wrapper over check-resume.ts (run via the tsx loader,
// since node can't execute .ts directly).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Cli } from '../container.js';

// The same four names the check_resume tool takes, so the CLI and the tool can
// be described in one breath.
export type CheckScopeName = 'all' | 'source' | 'pdf' | 'width';

export async function runCheck(_cli: Cli, { scope = 'all' }: { scope?: CheckScopeName } = {}): Promise<void> {
  const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-resume.ts');
  const args = ['--import', 'tsx', script];
  if (scope !== 'all') args.push(`--${scope}`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Checks failed.');
}
