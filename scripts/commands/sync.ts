// `resume sync` — refresh the scraped profile sources into profile/*.json.
import { root } from '../lib/root.js';
import { refreshAll } from '../lib/scrape/refresh.js';
import { hashSources, writeLock } from '../lib/sources.js';
import * as ui from '../lib/ui.js';
import { pc } from '../lib/ui.js';
import { timeAgo } from '../lib/format.js';
import type { GithubData, LinkedinData, RefreshResult } from '../lib/types.js';

const LABEL: Record<string, string> = { github: 'GitHub', linkedin: 'LinkedIn' };

export async function runSync({ force = false }: { force?: boolean } = {}): Promise<RefreshResult[]> {
  console.log(ui.banner('Sync Sources', force ? 'force re-scrape · GitHub + LinkedIn' : 'refresh what is stale · GitHub + LinkedIn'));
  console.log();

  const spin = ui.spinner();
  const results = await refreshAll(root, { force, log: (r) => { spin.text = `${LABEL[r.source] || r.source}: ${r.status}…`; } });
  spin.stop();

  // An explicit sync re-baselines the file-drift hashes: your curated facts are
  // "as of now", so the tailor won't nag afterwards.
  await writeLock(root, await hashSources(root));

  for (const r of results) {
    const name = LABEL[r.source] || r.source;
    if (r.status === 'error') { console.log(ui.fail(`${name}: ${r.error}`)); continue; }
    if (r.status === 'fresh') { console.log(ui.ok(`${name}: still fresh ${pc.dim(`(last ${timeAgo(r.at)})`)}`)); continue; }
    const t = r.source === 'github' ? (r.data as GithubData | undefined)?.totals : undefined;
    const detail = r.source === 'github' && t
      ? pc.dim(`${t.publicRepos} repos · ${t.totalStars}★ · ${t.mergedPRs} merged PRs · ${t.externalRepos} external repos`)
      : r.source === 'linkedin' && (r.data as LinkedinData | undefined)?.profile
        ? pc.dim(`${(r.data as LinkedinData).profile.experience?.length || 0} roles · via ${(r.data as LinkedinData).via}`)
        : '';
    const verb = r.status === 'unchanged' ? pc.dim('no changes') : pc.green(r.status);
    console.log(ui.ok(`${name}: ${verb} ${detail}`));
  }
  console.log('\n' + ui.info(pc.dim('Edit profile/github.json or profile/linkedin.json to correct anything — your edits persist until a scrape changes that field.')) + '\n');
  return results;
}
