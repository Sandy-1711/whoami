// `resume sync` — refresh the scraped profile sources into profile/*.json.
import {
  SourceRefresher, hashSources, writeLock, timeAgo, LINKEDIN_LIVE_DEPRECATED,
  type GithubData, type LinkedinData, type RefreshResult,
} from '@resume/core';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

const LABEL: Record<string, string> = { github: 'GitHub', linkedin: 'LinkedIn' };

export async function runSync(
  cli: Cli,
  { force = false, linkedin = false }: { force?: boolean; linkedin?: boolean } = {},
): Promise<RefreshResult[]> {
  console.log(ui.banner('Sync Sources', `${force ? 'force re-scrape' : 'refresh what is stale'} · GitHub`));
  console.log();
  if (linkedin) console.log(ui.warn(LINKEDIN_LIVE_DEPRECATED) + '\n');

  const refresher = new SourceRefresher({
    githubToken: cli.config.githubToken,
    linkedinCookie: cli.config.linkedinCookie,
    ttlHours: cli.config.scrapeTtlHours,
    liveLinkedin: false,
    // Only the LinkedIn structuring step calls it; a missing key surfaces as a
    // per-source error rather than blocking the GitHub scrape.
    llm: cli.llm,
  });

  const spin = ui.spinner();
  const results = await refresher.refreshAll(cli.root, { force, log: (r) => { spin.text = `${LABEL[r.source] || r.source}: ${r.status}…`; } });
  spin.stop();

  // An explicit sync re-baselines the file-drift hashes: your curated facts are
  // "as of now", so the tailor won't nag afterwards.
  await writeLock(cli.root, await hashSources(cli.root));

  for (const r of results) {
    const name = LABEL[r.source] || r.source;
    if (r.status === 'error') { console.log(ui.fail(`${name}: ${r.error}`)); continue; }
    if (r.status === 'skipped') { console.log(ui.info(`${name}: ${pc.dim('skipped — the live scrape is deprecated; profile/linkedin.json is still used')}`)); continue; }
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
