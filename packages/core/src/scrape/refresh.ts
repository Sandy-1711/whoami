// Keeps the scraped profile sources fresh, as an injectable service.
//
// Each source (github, linkedin) is refreshed only when it's stale (older than
// the TTL) or forced. After scraping we compare a content hash against the lock:
// if nothing changed, the JSON file is left untouched (no git churn). The lock's
// timestamp is always bumped so the TTL resets either way.
//
// Collaborators (tokens, cookie, TTL, the LLM provider used to structure the
// LinkedIn text) are injected, so this module reads no environment and is fully
// testable.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { contentHash, isStale, recordScrape, lastScrape } from '../profile/sources.js';
import { loadCuration, applyCuration } from '../profile/curation.js';
import type { LlmProvider } from '../ports/llm.js';
import { scrapeGithub, githubUsername } from './github.js';
import { scrapeLinkedin } from './linkedin.js';
import type { Facts, GithubData, LinkedinData, RefreshResult } from '../types.js';

export type RefreshLogger = (r: RefreshResult) => void;
type Scraper = (root: string) => Promise<GithubData | LinkedinData>;

export interface ScrapeConfig {
  githubToken: string;
  linkedinCookie: string;
  ttlHours: number;
  // Provider used to structure the LinkedIn profile. Undefined is allowed — the
  // linkedin scrape then fails soft (surfaced as a per-source error).
  llm?: LlmProvider;
}

async function readFacts(root: string): Promise<Facts> {
  return JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
}

export class SourceRefresher {
  private readonly scrapers: Record<string, Scraper>;

  constructor(private readonly config: ScrapeConfig) {
    this.scrapers = {
      github: async (root) => {
        const facts = await readFacts(root);
        const username = githubUsername(facts.identity?.github || 'Sandy-1711');
        const data = await scrapeGithub({ username, token: config.githubToken });
        // profile/curation.json: drop banned repos, float pinned ones first, so
        // github.json on disk (and everything downstream) is already curated.
        return applyCuration(data, await loadCuration(root));
      },
      linkedin: async (root) => {
        const facts = await readFacts(root);
        return scrapeLinkedin(root, {
          cookie: config.linkedinCookie,
          url: facts.identity?.linkedin || '',
          llm: config.llm,
        });
      },
    };
  }

  get sources(): string[] {
    return Object.keys(this.scrapers);
  }

  private ttlMs(): number {
    return this.config.ttlHours * 3600 * 1000;
  }

  // Refresh one source; writes profile/<source>.json only when content changed.
  async refreshSource(
    root: string,
    source: string,
    { force = false, log = () => {} }: { force?: boolean; log?: RefreshLogger } = {},
  ): Promise<RefreshResult> {
    const file = join(root, 'profile', `${source}.json`);
    const missing = !existsSync(file);

    if (!force && !missing && !(await isStale(root, source, this.ttlMs()))) {
      const prev = await lastScrape(root, source);
      log({ source, status: 'fresh', at: prev?.at });
      return { source, status: 'fresh', at: prev?.at };
    }

    let data: GithubData | LinkedinData;
    try {
      data = await this.scrapers[source]!(root);
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

  // Refresh every source. Scraping is independent of the file-drift baseline
  // (sync re-baselines that separately) so the tailor's "sources changed"
  // warning keeps working across auto-refreshes.
  async refreshAll(
    root: string,
    { force = false, log = () => {} }: { force?: boolean; log?: RefreshLogger } = {},
  ): Promise<RefreshResult[]> {
    const results: RefreshResult[] = [];
    for (const source of this.sources) {
      results.push(await this.refreshSource(root, source, { force, log }));
    }
    return results;
  }

  // Fail-soft freshness hook the tailor calls before every run.
  async ensureFresh(root: string, { log = () => {} }: { log?: RefreshLogger } = {}): Promise<RefreshResult[]> {
    return this.refreshAll(root, { force: false, log });
  }
}
