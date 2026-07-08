// Profile source syncing: hash the canonical inputs (resume, LinkedIn PDF, the
// fact base, and optionally a GitHub PR snapshot) so the tailor can warn when
// your profile has drifted from what the fact base was built against.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

// Files whose changes should invalidate the fact base.
export function sourceFiles(root) {
  return [
    { key: 'resume.tex', path: join(root, 'resume.tex') },
    { key: 'facts.json', path: join(root, 'profile', 'facts.json') },
    { key: 'linkedin.pdf', path: join(root, 'Linkedin_Profile.pdf') },
  ];
}

export async function hashSources(root) {
  const out = {};
  for (const { key, path } of sourceFiles(root)) {
    if (existsSync(path)) out[key] = sha(await readFile(path));
    else out[key] = null;
  }
  return out;
}

const LOCK = (root) => join(root, 'profile', 'sources.lock.json');

export async function readLock(root) {
  const p = LOCK(root);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeLock(root, hashes) {
  const payload = { updatedAt: new Date().toISOString(), hashes };
  await writeFile(LOCK(root), JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

// Compare current hashes against the lock; return the list of drifted sources.
export async function drift(root) {
  const lock = await readLock(root);
  const now = await hashSources(root);
  if (!lock) return { synced: false, changed: Object.keys(now), now, lock: null };
  const changed = Object.keys(now).filter((k) => now[k] !== lock.hashes?.[k]);
  return { synced: changed.length === 0, changed, now, lock };
}
