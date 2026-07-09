// The monorepo root, resolved once. apps/cli/src/ -> ../../../ is the repo root,
// where the résumé data lives (resume.tex, profile/, tailored/, build/).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const repoRoot: string = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
