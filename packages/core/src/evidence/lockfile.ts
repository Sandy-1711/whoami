// Build lockfile (architecture Layer 7).
//
// Every coverage-based tailor run writes tailored/<slug>/build.lock.json — a
// reproducible record of WHAT produced this résumé: the JD's requirement graph +
// hash, the weights hash, the template (resume.tex) hash, and every selected
// evidence unit with its coverage score and target anchor. `resume audit` (C28)
// replays it to prove the build is still grounded and its guards still pass
// before you submit. The names here are BuildLock/read|writeBuildLock to avoid
// clashing with the profile source Lock in profile/sources.ts.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { OutputPaths, Score } from '../types.js';
import type { RequirementGraph } from './requirements.js';
import type { Weights } from './relevance.js';

export const BUILD_LOCK_VERSION = 1 as const;

export interface LockedUnit {
  id: string;
  claim: string;
  score: number;   // relevance/coverage contribution at selection time
  anchor: string;  // the resume.tex TAILOR anchor this unit's bullet rendered into
}

export interface BuildLock {
  version: typeof BUILD_LOCK_VERSION;
  company: string;
  role: string;
  jd_hash: string;
  weights_hash: string;
  template_hash: string; // sha of the resume.tex the build rendered from
  requirement_graph: RequirementGraph;
  selected: LockedUnit[];
  ats_score: Score;       // deterministic ATS score, for report continuity
  coverage_score: number; // the selector's objective value
  guards_pass: boolean;
  createdAt: string;
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

export function hashWeights(weights: Weights): string {
  return sha(JSON.stringify(weights));
}

export function hashTemplate(resumeTex: string): string {
  return sha(resumeTex);
}

export function buildLockPath(paths: OutputPaths): string {
  return join(paths.dir, 'build.lock.json');
}

export async function writeBuildLock(paths: OutputPaths, lock: BuildLock): Promise<string> {
  const p = buildLockPath(paths);
  await writeFile(p, JSON.stringify(lock, null, 2) + '\n');
  return p;
}

export async function readBuildLock(path: string): Promise<BuildLock | null> {
  if (!existsSync(path)) return null;
  try {
    const lock = JSON.parse(await readFile(path, 'utf8')) as BuildLock;
    if (lock?.version !== BUILD_LOCK_VERSION) return null;
    return lock;
  } catch {
    return null;
  }
}
