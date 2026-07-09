// `resume status` — one screen showing everything: environment readiness, the
// LaTeX toolchain, scraped-source freshness, the built résumé, and the tailored
// outputs on disk.
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readLock, drift, timeAgo, type GithubData, type LinkedinData } from '@resume/core';
import { haveCmd, dockerDaemonUp } from '../adapters/latex.js';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

const yes = pc.green('●');
const no = pc.red('○');
const optional = pc.yellow('○');

async function readJson<T = any>(p: string): Promise<T | null> {
  try { return JSON.parse(await readFile(p, 'utf8')) as T; } catch { return null; }
}

function havePlaywright(root: string): boolean {
  return existsSync(join(root, 'node_modules', 'playwright'))
    || existsSync(join(root, 'packages', 'core', 'node_modules', 'playwright'));
}

export async function runStatus(cli: Cli): Promise<void> {
  const { root, config, registry } = cli;
  console.log(ui.banner('Résumé Studio', 'status · sources · outputs'));

  // ---- environment ---------------------------------------------------------
  const playwright = havePlaywright(root);
  const active = registry.defaultProviderId(config);
  const anyKey = registry.list().some((f) => config.llm.keys[f.id]);
  console.log(ui.heading('Environment'));
  console.log(ui.kv('LLM provider', anyKey ? `${yes} ${pc.dim(active)}` : `${no} ${pc.red('no API key — tailoring will fail')}`));
  for (const f of registry.list()) {
    const key = config.llm.keys[f.id];
    const model = config.llm.models[f.id] || f.defaultModel;
    const tag = active === f.id && key ? ` ${pc.cyan('← active')}` : '';
    console.log(ui.kv(`${f.label} key`, key ? `${yes} set ${pc.dim(`(${model})`)}${tag}` : `${optional} ${pc.dim('unset')}`));
  }
  console.log(ui.kv('GitHub token', config.githubToken ? `${yes} set` : `${optional} ${pc.dim('unset — public scrape, lower rate limit')}`));
  console.log(ui.kv('LinkedIn live', config.linkedinCookie && playwright ? `${yes} cookie + Playwright` : `${optional} ${pc.dim(`${config.linkedinCookie ? 'cookie set' : 'no cookie'}, ${playwright ? 'Playwright ready' : 'Playwright not installed'} — PDF fallback`)}`));

  // ---- toolchain -----------------------------------------------------------
  const latexmk = haveCmd('latexmk');
  const docker = haveCmd('docker');
  const daemon = docker && dockerDaemonUp();
  const canBuild = latexmk || daemon;
  console.log(ui.heading('LaTeX toolchain'));
  console.log(ui.kv('render', canBuild
    ? `${yes} ${latexmk ? 'local latexmk' : 'Docker'}`
    : `${no} ${pc.red(docker ? 'Docker installed but daemon down — start Docker Desktop' : 'no latexmk or Docker')}`));

  // ---- scraped sources -----------------------------------------------------
  const lock = await readLock(root);
  const gh = await readJson<GithubData>(join(root, 'profile', 'github.json'));
  const li = await readJson<LinkedinData>(join(root, 'profile', 'linkedin.json'));
  console.log(ui.heading('Scraped sources'));
  console.log(ui.kv('GitHub', gh
    ? `${yes} ${pc.dim(`${gh.totals?.publicRepos ?? '?'} repos · ${gh.totals?.totalStars ?? '?'}★ · ${gh.totals?.mergedPRs ?? '?'} merged PRs`)} ${pc.dim(`· scraped ${timeAgo(lock.scrape?.github?.at)}`)}`
    : `${no} ${pc.dim('not scraped yet — run sync')}`));
  console.log(ui.kv('LinkedIn', li
    ? `${yes} ${pc.dim(`${li.profile?.experience?.length ?? '?'} roles · via ${li.via}`)} ${pc.dim(`· scraped ${timeAgo(lock.scrape?.linkedin?.at)}`)}`
    : `${no} ${pc.dim('not scraped yet — run sync')}`));

  const d = await drift(root);
  if (d.lock && !d.synced) console.log(ui.kv('drift', ui.warn(`${d.changed.join(', ')} changed since last sync`)));
  else if (d.lock) console.log(ui.kv('drift', `${yes} ${pc.dim('in sync')}`));

  // ---- built résumé --------------------------------------------------------
  console.log(ui.heading('Canonical résumé'));
  const pdf = join(root, 'apps', 'web', 'assets', 'resume.pdf');
  if (existsSync(pdf)) {
    const s = await stat(pdf);
    console.log(ui.kv('apps/web/assets/resume.pdf', `${yes} ${pc.dim(`${(s.size / 1024).toFixed(0)} KB · built ${timeAgo(s.mtime.toISOString())}`)}`));
  } else {
    console.log(ui.kv('apps/web/assets/resume.pdf', `${optional} ${pc.dim('not built — run `pnpm build:pdf`')}`));
  }

  // ---- tailored outputs ----------------------------------------------------
  console.log(ui.heading('Tailored outputs'));
  const pdfs = await listPdfs(join(root, 'tailored'));
  if (!pdfs.length) console.log('  ' + pc.dim('(none yet — run tailor)'));
  else for (const p of pdfs.slice(0, 12)) console.log(ui.kv(pc.cyan(relative(join(root, 'tailored'), p.path).replace(/\\/g, '/')), pc.dim(timeAgo(p.mtime))));
  console.log();
}

interface PdfEntry { path: string; mtime: string; }

async function listPdfs(dir: string): Promise<PdfEntry[]> {
  if (!existsSync(dir)) return [];
  const out: PdfEntry[] = [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) {
      const path = join((e as unknown as { parentPath?: string; path?: string }).parentPath || (e as unknown as { path?: string }).path || dir, e.name);
      try { out.push({ path, mtime: (await stat(path)).mtime.toISOString() }); } catch { /* skip */ }
    }
  }
  return out.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
}
