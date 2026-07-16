// Shared readers for the scraped profile sources. Missing or unparsable scrape
// files degrade to null — a fresh clone without a sync still works everywhere,
// the digest just comes back empty. A malformed curation.json, by contrast,
// still throws (via loadCuration): failing soft there would silently un-ban
// repos in every prompt that consumes the digest.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GithubData, LinkedinData } from '../types.js';
import { loadCuration } from './curation.js';
import { buildProfileDigest, renderProfileDigest, type ProfileDigest } from './digest.js';

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return null; }
}

export async function loadGithubData(root: string): Promise<GithubData | null> {
  return readJson<GithubData>(join(root, 'profile', 'github.json'));
}

export async function loadLinkedinData(root: string): Promise<LinkedinData | null> {
  return readJson<LinkedinData>(join(root, 'profile', 'linkedin.json'));
}

// Load both scrapes + curation and build the digest. Curation is applied at
// read time so a curation.json edit takes effect immediately, even when
// github.json was scraped before the edit.
export async function loadProfileDigest(root: string): Promise<ProfileDigest> {
  const [github, linkedin, curation] = await Promise.all([
    loadGithubData(root),
    loadLinkedinData(root),
    loadCuration(root),
  ]);
  return buildProfileDigest(github, linkedin, curation);
}

// The prompt-ready plain-text rendering; '' when there is no scrape data.
export async function loadProfileDigestText(root: string): Promise<string> {
  return renderProfileDigest(await loadProfileDigest(root));
}
