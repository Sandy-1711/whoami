import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeBuildLock, readBuildLock, buildLockPath, hashWeights, hashTemplate,
  BUILD_LOCK_VERSION, type BuildLock,
} from './lockfile.js';
import { DEFAULT_WEIGHTS } from './relevance.js';
import type { OutputPaths } from '../types.js';

const paths = (dir: string): OutputPaths => ({
  slug: 'acme', role: 'AI Engineer', base: 'b', dir, relDir: 'tailored/acme',
  tex: '', pdf: '', report: '', buildTex: '', buildTexRel: '', buildPdf: '', buildLog: '',
});

const lock = (): BuildLock => ({
  version: BUILD_LOCK_VERSION,
  company: 'Acme', role: 'AI Engineer',
  jd_hash: 'jd123', weights_hash: hashWeights(DEFAULT_WEIGHTS), template_hash: hashTemplate('\\doc'),
  requirement_graph: { must_have: [], nice_to_have: [], ats_keywords: [], seniority: 'mid', domain: 'ai', jd_hash: 'jd123' },
  selected: [{ id: 'ev_a', claim: 'built X', score: 0.9, anchor: 'exp-aira' }],
  ats_score: { before: 40, after: 70, total: 100 },
  coverage_score: 3.2, guards_pass: true, createdAt: new Date().toISOString(),
});

describe('build lockfile', () => {
  it('hashes are deterministic and content-sensitive', () => {
    expect(hashWeights(DEFAULT_WEIGHTS)).toBe(hashWeights(DEFAULT_WEIGHTS));
    expect(hashTemplate('a')).not.toBe(hashTemplate('b'));
  });

  it('round-trips through disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lock-'));
    const p = paths(root);
    const written = await writeBuildLock(p, lock());
    expect(written).toBe(buildLockPath(p));
    const back = await readBuildLock(written);
    expect(back!.company).toBe('Acme');
    expect(back!.selected[0].anchor).toBe('exp-aira');
  });

  it('returns null for a missing file or a version mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lock-'));
    expect(await readBuildLock(join(root, 'nope.json'))).toBeNull();
    const p = paths(root);
    await writeBuildLock(p, { ...lock(), version: 99 as unknown as typeof BUILD_LOCK_VERSION });
    expect(await readBuildLock(buildLockPath(p))).toBeNull();
  });
});
