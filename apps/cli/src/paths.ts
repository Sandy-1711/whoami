// The monorepo root, resolved once. apps/cli/src/ -> ../../../ is the repo root,
// where the résumé data lives (resume.tex, profile/, tailored/, build/).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export const repoRoot: string = join(here, '..', '..', '..');

/**
 * The PDF build script: renders profile/resume.json, then compiles it the way
 * CI does. Spawn it with the tsx loader — node cannot execute .ts directly.
 */
export const buildPdfScript: string = join(here, 'build-pdf.ts');
