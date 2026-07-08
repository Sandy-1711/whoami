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
import { scrapeGithub, githubUsername } from './github.js';
import { scrapeLinkedin } from './linkedin.js';

const TTL_MS = (Number(process.env.SCRAPE_TTL_HOURS) || 12) * 3600 * 1000;

async function readFacts(root) {
  return JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
}

// Refresh one scraped source. `scrape()` returns the fresh data object; the
// result is written to profile/<source>.json only when its content changed.
async function refreshSource(root, source, { force = false, log = () => {} } = {}) {
  const file = join(root, 'profile', `${source}.json`);
  const missing = !existsSync(file);

  if (!force && !missing && !(await isStale(root, source, TTL_MS))) {
    const prev = await lastScrape(root, source);
    log({ source, status: 'fresh', at: prev?.at });
    return { source, status: 'fresh', at: prev?.at };
  }

  let data;
  try {
    data = await SCRAPERS[source](root);
  } catch (err) {
    log({ source, status: 'error', error: err.message });
    return { source, status: 'error', error: err.message };
  }

  const hash = contentHash(data);
  const prev = await lastScrape(root, source);
  const changed = missing || prev?.hash !== hash;
  if (changed) await writeFile(file, JSON.stringify(data, null, 2) + '\n');
  await recordScrape(root, source, hash);

  const status = changed ? (missing ? 'created' : 'updated') : 'unchanged';
  log({ source, status, data });
  return { source, status, data };
}

// Per-source scrape closures.
const SCRAPERS = {
  async github(root) {
    const facts = await readFacts(root);
    const username = githubUsername(facts.identity?.github || 'Sandy-1711');
    return scrapeGithub({ username, token: process.env.GITHUB_TOKEN });
  },
  async linkedin(root) {
    const facts = await readFacts(root);
    return scrapeLinkedin(root, {
      cookie: process.env.LINKEDIN_COOKIE,
      url: facts.identity?.linkedin || '',
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    });
  },
};

export const SOURCES = Object.keys(SCRAPERS);

// Refresh every scraped source. Scraping is independent of the file-drift
// baseline (the sync command re-baselines that separately) so the tailor's
// "sources changed" warning keeps working across auto-refreshes.
export async function refreshAll(root, { force = false, log = () => {} } = {}) {
  const results = [];
  for (const source of SOURCES) {
    results.push(await refreshSource(root, source, { force, log }));
  }
  return results;
}

// Fail-soft freshness hook the tailor calls before every run: refresh what's
// stale, but never let a scrape failure block tailoring — warn and continue on
// the cached JSON.
export async function ensureFresh(root, { log = () => {} } = {}) {
  return refreshAll(root, { force: false, log });
}

export { refreshSource };
