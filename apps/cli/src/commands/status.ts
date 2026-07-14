// `resume status` — one screen showing everything: environment readiness, the
// LaTeX toolchain, scraped-source freshness, the built résumé, and the tailored
// outputs on disk. The data is gathered by core's collectStatus(); this command
// injects the two env probes it can't do (render engine, Playwright) and renders.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectStatus, timeAgo, type StatusReport } from '@resume/core';
import { renderEngineReason } from '../adapters/latex.js';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

const yes = pc.green('●');
const no = pc.red('○');
const optional = pc.yellow('○');

function havePlaywright(root: string): boolean {
  return existsSync(join(root, 'node_modules', 'playwright'))
    || existsSync(join(root, 'packages', 'core', 'node_modules', 'playwright'));
}

export async function runStatus(cli: Cli): Promise<StatusReport> {
  const { root, config, registry } = cli;
  console.log(ui.banner('Résumé Studio', 'status · sources · outputs'));

  const report = await collectStatus({
    root,
    config,
    providers: registry.list().map((f) => ({ id: f.id, label: f.label, defaultModel: f.defaultModel })),
    activeProviderId: registry.defaultProviderId(config),
    renderReason: renderEngineReason(),
    playwright: havePlaywright(root),
  });

  // ---- environment ---------------------------------------------------------
  console.log(ui.heading('Environment'));
  console.log(ui.kv('LLM provider', report.env.anyKey
    ? `${yes} ${pc.dim(report.env.activeProvider)}`
    : `${no} ${pc.red('no API key — tailoring will fail')}`));
  for (const p of report.env.providers) {
    const tag = p.active ? ` ${pc.cyan('← active')}` : '';
    console.log(ui.kv(`${p.label} key`, p.keySet ? `${yes} set ${pc.dim(`(${p.model})`)}${tag}` : `${optional} ${pc.dim('unset')}`));
  }
  console.log(ui.kv('GitHub token', report.env.githubToken ? `${yes} set` : `${optional} ${pc.dim('unset — public scrape, lower rate limit')}`));
  console.log(ui.kv('LinkedIn live', report.env.linkedin.live
    ? `${yes} cookie + Playwright`
    : `${optional} ${pc.dim(`${report.env.linkedin.detail} — PDF fallback`)}`));

  // ---- toolchain -----------------------------------------------------------
  console.log(ui.heading('LaTeX toolchain'));
  console.log(ui.kv('render', report.toolchain.canRender
    ? `${yes} available`
    : `${no} ${pc.red(report.toolchain.reason === 'docker-daemon-down' ? 'Docker installed but daemon down — start Docker Desktop' : 'no latexmk or Docker')}`));

  // ---- scraped sources -----------------------------------------------------
  console.log(ui.heading('Scraped sources'));
  console.log(ui.kv('GitHub', report.sources.github.present
    ? `${yes} ${pc.dim(report.sources.github.summary)} ${pc.dim(`· scraped ${timeAgo(report.sources.github.scrapedAt)}`)}`
    : `${no} ${pc.dim('not scraped yet — run sync')}`));
  console.log(ui.kv('LinkedIn', report.sources.linkedin.present
    ? `${yes} ${pc.dim(report.sources.linkedin.summary)} ${pc.dim(`· scraped ${timeAgo(report.sources.linkedin.scrapedAt)}`)}`
    : `${no} ${pc.dim('not scraped yet — run sync')}`));
  const dr = report.sources.drift;
  if (dr.hasBaseline && !dr.synced) console.log(ui.kv('drift', ui.warn(`${dr.changed.join(', ')} changed since last sync`)));
  else if (dr.hasBaseline) console.log(ui.kv('drift', `${yes} ${pc.dim('in sync')}`));

  // ---- built résumé --------------------------------------------------------
  console.log(ui.heading('Canonical résumé'));
  console.log(ui.kv('apps/web/assets/resume.pdf', report.canonical.built
    ? `${yes} ${pc.dim(`${report.canonical.sizeKb} KB · built ${timeAgo(report.canonical.builtAt)}`)}`
    : `${optional} ${pc.dim('not built — run `pnpm build:pdf`')}`));

  // ---- tailored outputs ----------------------------------------------------
  console.log(ui.heading('Tailored outputs'));
  if (!report.tailored.length) console.log('  ' + pc.dim('(none yet — run tailor)'));
  else for (const t of report.tailored.slice(0, 12)) console.log(ui.kv(pc.cyan(t.relPath), pc.dim(timeAgo(t.mtime))));
  console.log();

  return report;
}
