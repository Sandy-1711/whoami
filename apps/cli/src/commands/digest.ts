// `resume digest` — print the deterministic profile digest: the ranked ~2 KB
// distillation of github.json + linkedin.json (curation pins/bans applied)
// that the drafting prompts inject as evidence. Free: no LLM, no network.
// Output is intentionally plain (no banner) so agents and skills can consume
// it directly — Claude Code runs `pnpm digest` instead of parsing 34 KB of JSON.
import { loadProfileDigest, renderProfileDigest } from '@resume/core';
import type { Cli } from '../container.js';

export interface RunDigestArgs {
  json?: boolean;
}

export async function runDigest(cli: Cli, args: RunDigestArgs = {}): Promise<void> {
  const digest = await loadProfileDigest(cli.root);

  if (args.json) {
    console.log(JSON.stringify(digest, null, 2));
    return;
  }

  const text = renderProfileDigest(digest);
  if (!text) {
    console.error('No scrape data — run `pnpm sync` to fetch GitHub (and optionally --linkedin) first.');
    return;
  }
  console.log(text);
}
