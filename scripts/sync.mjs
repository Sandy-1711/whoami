#!/usr/bin/env node
// Refresh the scraped profile sources (GitHub, LinkedIn) into profile/*.json.
//
//   npm run sync            # refresh anything stale (older than the TTL)
//   npm run sync -- --force # re-scrape everything now, ignore the TTL
//
// Scraped JSON is an editable source of truth: hand-edit it and the tailor uses
// your version until the next scrape changes it.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ora from 'ora';
import dotenv from 'dotenv';
import { refreshAll } from './lib/scrape/refresh.js';
import { hashSources, writeLock } from './lib/sources.js';
import * as ui from './lib/ui.js';
import { chalk } from './lib/ui.js';
dotenv.config({ quiet: true });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

const LABEL = { github: 'GitHub', linkedin: 'LinkedIn' };

async function main() {
  console.log(ui.banner('Sync Sources', force ? 'force re-scrape · GitHub + LinkedIn' : 'refresh what is stale · GitHub + LinkedIn'));
  console.log();

  const spin = ora({ color: 'cyan' }).start();
  const results = await refreshAll(root, {
    force,
    log: (r) => { spin.text = `${LABEL[r.source] || r.source}: ${r.status}…`; },
  });
  spin.stop();

  // An explicit sync also re-baselines the file-drift hashes: after a sync your
  // curated facts.json / resume.tex are "as of now", so the tailor won't nag.
  await writeLock(root, await hashSources(root));

  for (const r of results) {
    const name = LABEL[r.source] || r.source;
    if (r.status === 'error') { console.log(ui.fail(`${name}: ${r.error}`)); continue; }
    if (r.status === 'fresh') { console.log(ui.ok(`${name}: still fresh ${chalk.dim(`(last ${timeAgo(r.at)})`)}`)); continue; }
    const t = r.data?.totals;
    const detail = r.source === 'github' && t
      ? chalk.dim(`${t.publicRepos} repos · ${t.totalStars}★ · ${t.mergedPRs} merged PRs · ${t.externalRepos} external repos`)
      : '';
    const verb = r.status === 'unchanged' ? chalk.dim('no changes') : chalk.green(r.status);
    console.log(ui.ok(`${name}: ${verb} ${detail}`));
  }
  console.log('\n' + ui.info(chalk.dim('Edit profile/github.json or profile/linkedin.json to correct anything — your edits persist until a scrape changes that field.')) + '\n');
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

main().catch((e) => { console.error('\n' + ui.fail(e.stack || e.message) + '\n'); process.exit(1); });
