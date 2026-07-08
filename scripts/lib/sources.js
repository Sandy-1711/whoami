// Profile source state: two jobs in one lock file (profile/sources.lock.json).
//
//  1. File drift — hash the canonical inputs (resume.tex, facts.json, the raw
//     LinkedIn PDF) so the tailor can warn when your profile has drifted from
//     what the fact base was built against.
//  2. Scrape freshness — remember when each scraped source (github, linkedin)
//     was last pulled and a content hash of what came back, so we can (a) skip
//     re-scraping while it's still fresh, and (b) avoid rewriting the JSON when
//     nothing actually changed.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

// Stable content hash for a scraped object — ignores volatile fields so an
// identical scrape hashes the same across runs.
export function contentHash(obj) {
  const { _comment, scrapedAt, ...rest } = obj || {};
  return sha(JSON.stringify(rest));
}

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
    out[key] = existsSync(path) ? sha(await readFile(path)) : null;
  }
  return out;
}

const LOCK = (root) => join(root, 'profile', 'sources.lock.json');

// Read + normalize the lock to the current shape, tolerating the older
// { updatedAt, hashes } layout.
export async function readLock(root) {
  const p = LOCK(root);
  if (!existsSync(p)) return { files: {}, scrape: {} };
  try {
    const raw = JSON.parse(await readFile(p, 'utf8'));
    return {
      files: raw.files || raw.hashes || {},
      scrape: raw.scrape || {},
      updatedAt: raw.updatedAt,
    };
  } catch {
    return { files: {}, scrape: {} };
  }
}

async function saveLock(root, lock) {
  const payload = { updatedAt: new Date().toISOString(), files: lock.files || {}, scrape: lock.scrape || {} };
  await writeFile(LOCK(root), JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

// Re-baseline the file drift hashes (leaves scrape state untouched).
export async function writeLock(root, hashes) {
  const lock = await readLock(root);
  lock.files = hashes;
  return saveLock(root, lock);
}

// Compare current file hashes against the lock; return the drifted keys.
export async function drift(root) {
  const lock = await readLock(root);
  const now = await hashSources(root);
  const has = Object.keys(lock.files || {}).length > 0;
  if (!has) return { synced: false, changed: Object.keys(now), now, lock: null };
  const changed = Object.keys(now).filter((k) => now[k] !== lock.files[k]);
  return { synced: changed.length === 0, changed, now, lock };
}

// ---- scrape freshness -------------------------------------------------------

export async function lastScrape(root, source) {
  const lock = await readLock(root);
  return lock.scrape?.[source] || null;
}

// True when `source` has never been scraped or its last scrape is older than ttlMs.
export async function isStale(root, source, ttlMs) {
  const s = await lastScrape(root, source);
  if (!s?.at) return true;
  return Date.now() - new Date(s.at).getTime() > ttlMs;
}

// Record a completed scrape (timestamp + content hash) for a source.
export async function recordScrape(root, source, hash) {
  const lock = await readLock(root);
  lock.scrape = lock.scrape || {};
  lock.scrape[source] = { at: new Date().toISOString(), hash };
  return saveLock(root, lock);
}
