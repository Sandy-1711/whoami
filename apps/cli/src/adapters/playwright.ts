// Environment probe for the LinkedIn live scrape. It is a node_modules lookup,
// so it belongs with the adapters and is passed in as a flag — that is what keeps
// @resume/core free of filesystem assumptions about how it was installed.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** True when Playwright resolves from the repo root or from @resume/core. */
export function havePlaywright(root: string): boolean {
  return existsSync(join(root, 'node_modules', 'playwright'))
    || existsSync(join(root, 'packages', 'core', 'node_modules', 'playwright'));
}
