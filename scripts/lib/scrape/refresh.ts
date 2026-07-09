// Orchestrates keeping the scraped profile sources fresh.
//
// Each source (github, linkedin) is refreshed only when it's stale (older than
// the TTL) or forced. After scraping we compare a content hash against the lock:
// if nothing changed, the JSON file is left untouched (no git churn) — the hash
// is what "prevents repetitions". The lock's timestamp is always bumped so the
// TTL resets either way.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { contentHash, isStale, recordScrape, lastScrape } from '../sources.js';
import { env } from '../env.js';
import { resolveLlm } from '../llm.js';
import { scrapeGithub, githubUsername } from './github.js';
import { scrapeLinkedin } from './linkedin.js';
import type { Facts, GithubData, LinkedinData, RefreshResult } from '../types.js';

type Logger = (r: RefreshResult) => void;
type Scraper = (root: string) => Promise<GithubData | LinkedinData>;

const ttlMs = (): number => env.scrapeTtlHours * 3600 * 1000;

async function readFacts(root: string): Promise<Facts> {
  return JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
}

// Refresh one scraped source. `scrape()` returns the fresh data object; the
// result is written to profile/<source>.json only when its content changed.
async function refreshSource(
  root: string,
  source: string,
  { force = false, log = () => {} }: { force?: boolean; log?: Logger } = {},
): Promise<RefreshResult> {
  const file = join(root, 'profile', `${source}.json`);
  const missing = !existsSync(file);

  if (!force && !missing && !(await isStale(root, source, ttlMs()))) {
    const prev = await lastScrape(root, source);
    log({ source, status: 'fresh', at: prev?.at });
    return { source, status: 'fresh', at: prev?.at };
  }

  let data: GithubData | LinkedinData;
  try {
    data = await SCRAPERS[source]!(root);
  } catch (err) {
    log({ source, status: 'error', error: (err as Error).message });
    return { source, status: 'error', error: (err as Error).message };
  }

  const hash = contentHash(data as unknown as Record<string, unknown>);
  const prev = await lastScrape(root, source);
  const changed = missing || prev?.hash !== hash;
  if (changed) await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  await recordScrape(root, source, hash);

  const status = changed ? (missing ? 'created' : 'updated') : 'unchanged';
  log({ source, status, data });
  return { source, status, data };
}

// Per-source scrape closures.
const SCRAPERS: Record<string, Scraper> = {
  async github(root) {
    const facts = await readFacts(root);
    const username = githubUsername(facts.identity?.github || 'Sandy-1711');
    return scrapeGithub({ username, token: env.githubToken });
  },
  async linkedin(root) {
    const facts = await readFacts(root);
    return scrapeLinkedin(root, {
      cookie: env.linkedinCookie,
      url: facts.identity?.linkedin || '',
      llm: resolveLlm(),  // active provider from env; throws (soft-caught) if no key
    });
  },
};

export const SOURCES: string[] = Object.keys(SCRAPERS);

// Refresh every scraped source. Scraping is independent of the file-drift
// baseline (the sync command re-baselines that separately) so the tailor's
// "sources changed" warning keeps working across auto-refreshes.
export async function refreshAll(
  root: string,
  { force = false, log = () => {} }: { force?: boolean; log?: Logger } = {},
): Promise<RefreshResult[]> {
  const results: RefreshResult[] = [];
  for (const source of SOURCES) {
    results.push(await refreshSource(root, source, { force, log }));
  }
  return results;
}

// Fail-soft freshness hook the tailor calls before every run: refresh what's
// stale, but never let a scrape failure block tailoring — warn and continue on
// the cached JSON.
export async function ensureFresh(root: string, { log = () => {} }: { log?: Logger } = {}): Promise<RefreshResult[]> {
  return refreshAll(root, { force: false, log });
}

export { refreshSource };
