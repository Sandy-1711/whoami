// Manual repo curation for the GitHub scrape. profile/curation.json is a
// user-edited file (never written by sync) with two lists:
//   - "pin": repos to always surface first, in the order listed,
//   - "ban": repos to drop everywhere — from github.json on sync, and from any
//     LLM prompt that draws on it.
// Own repos match by bare name ("whoami") or "username/name"; external
// contribution repos match by their full "owner/name". Matching is
// case-insensitive.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GithubData, GithubRepo, GithubContribution } from '../types.js';

export interface Curation {
  pin: string[];
  ban: string[];
}

export const EMPTY_CURATION: Curation = { pin: [], ban: [] };

// Read profile/curation.json. A missing file means "no curation" (empty lists);
// a malformed one throws — silently ignoring it would quietly un-ban repos.
export async function loadCuration(root: string): Promise<Curation> {
  const path = join(root, 'profile', 'curation.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return EMPTY_CURATION;
  }
  let parsed: { pin?: unknown; ban?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`profile/curation.json is not valid JSON: ${(err as Error).message}`);
  }
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [];
  return { pin: list(parsed.pin), ban: list(parsed.ban) };
}

// Position of a repo in the pin list (-1 when not pinned). `names` are the
// normalized identifiers the repo answers to.
function pinIndex(pin: string[], names: string[]): number {
  return pin.findIndex((p) => names.includes(p.toLowerCase()));
}

function ownRepoNames(username: string, repo: GithubRepo): string[] {
  const name = repo.name.toLowerCase();
  return [name, `${username.toLowerCase()}/${name}`];
}

// Apply the curation to a scraped GithubData: drop banned repos and
// contributions, float pinned ones to the front (in pin-list order, flagged
// `pinned: true`), and recompute the totals so banned work doesn't count.
export function applyCuration(data: GithubData, curation: Curation): GithubData {
  if (!curation.pin.length && !curation.ban.length) return data;
  const ban = curation.ban.map((s) => s.toLowerCase());

  const repos = data.repos
    .filter((r) => !ownRepoNames(data.username, r).some((n) => ban.includes(n)))
    .map((r): GithubRepo & { _pin: number } => {
      const idx = pinIndex(curation.pin, ownRepoNames(data.username, r));
      return { ...r, ...(idx >= 0 ? { pinned: true } : {}), _pin: idx };
    })
    .sort((a, b) => {
      if (a._pin >= 0 || b._pin >= 0) {
        if (a._pin < 0) return 1;
        if (b._pin < 0) return -1;
        return a._pin - b._pin;
      }
      return 0; // stable sort keeps the scraper's stars/pushed order
    })
    .map(({ _pin, ...r }) => r);

  const contributions = data.contributions
    .filter((c) => !ban.includes(c.repo.toLowerCase()))
    .map((c): GithubContribution & { _pin: number } => {
      const idx = pinIndex(curation.pin, [c.repo.toLowerCase()]);
      return { ...c, ...(idx >= 0 ? { pinned: true } : {}), _pin: idx };
    })
    .sort((a, b) => {
      if (a._pin >= 0 || b._pin >= 0) {
        if (a._pin < 0) return 1;
        if (b._pin < 0) return -1;
        return a._pin - b._pin;
      }
      return 0;
    })
    .map(({ _pin, ...c }) => c);

  const own = repos.filter((r) => !r.fork);
  return {
    ...data,
    repos,
    contributions,
    totals: {
      publicRepos: own.length,
      totalStars: own.reduce((n, r) => n + r.stars, 0),
      mergedPRs: contributions.reduce((n, c) => n + c.merged, 0),
      externalRepos: contributions.length,
    },
  };
}
