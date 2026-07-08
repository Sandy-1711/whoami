// `resume sync` — refresh the scraped profile sources into profile/*.json.
import ora from 'ora';
import { root } from '../lib/root.js';
import { refreshAll } from '../lib/scrape/refresh.js';
import { hashSources, writeLock } from '../lib/sources.js';
import * as ui from '../lib/ui.js';
import { chalk } from '../lib/ui.js';
import { timeAgo } from '../lib/format.js';

const LABEL = { github: 'GitHub', linkedin: 'LinkedIn' };

export async function runSync({ force = false } = {}) {
  console.log(ui.banner('Sync Sources', force ? 'force re-scrape · GitHub + LinkedIn' : 'refresh what is stale · GitHub + LinkedIn'));
  console.log();

  const spin = ora({ color: 'cyan' }).start();
  const results = await refreshAll(root, { force, log: (r) => { spin.text = `${LABEL[r.source] || r.source}: ${r.status}…`; } });
  spin.stop();

  // An explicit sync re-baselines the file-drift hashes: your curated facts are
  // "as of now", so the tailor won't nag afterwards.
  await writeLock(root, await hashSources(root));

  for (const r of results) {
    const name = LABEL[r.source] || r.source;
    if (r.status === 'error') { console.log(ui.fail(`${name}: ${r.error}`)); continue; }
    if (r.status === 'fresh') { console.log(ui.ok(`${name}: still fresh ${chalk.dim(`(last ${timeAgo(r.at)})`)}`)); continue; }
    const t = r.data?.totals;
    const detail = r.source === 'github' && t
      ? chalk.dim(`${t.publicRepos} repos · ${t.totalStars}★ · ${t.mergedPRs} merged PRs · ${t.externalRepos} external repos`)
      : r.source === 'linkedin' && r.data?.profile
        ? chalk.dim(`${r.data.profile.experience?.length || 0} roles · via ${r.data.via}`)
        : '';
    const verb = r.status === 'unchanged' ? chalk.dim('no changes') : chalk.green(r.status);
    console.log(ui.ok(`${name}: ${verb} ${detail}`));
  }
  console.log('\n' + ui.info(chalk.dim('Edit profile/github.json or profile/linkedin.json to correct anything — your edits persist until a scrape changes that field.')) + '\n');
  return results;
}
