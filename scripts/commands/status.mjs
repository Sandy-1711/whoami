// `resume status` — one screen showing everything: environment readiness, the
// LaTeX toolchain, scraped-source freshness, the built résumé, and the tailored
// outputs on disk.
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { root } from '../lib/root.js';
import { env } from '../lib/env.js';
import { readLock, drift } from '../lib/sources.js';
import { haveCmd, dockerDaemonUp } from '../lib/latex.js';
import * as ui from '../lib/ui.js';
import { chalk } from '../lib/ui.js';
import { timeAgo } from '../lib/format.js';

const yes = chalk.green('●');
const no = chalk.red('○');
const opt = chalk.yellow('○');

async function readJson(p) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } }

export async function runStatus() {
  console.log(ui.banner('Résumé Studio', 'status · sources · outputs'));

  // ---- environment ---------------------------------------------------------
  const playwright = existsSync(join(root, 'node_modules', 'playwright'));
  console.log(ui.heading('Environment'));
  console.log(ui.kv('Gemini key', env.geminiKey ? `${yes} set ${chalk.dim(`(${env.geminiModel})`)}` : `${no} ${chalk.red('missing — tailoring will fail')}`));
  console.log(ui.kv('GitHub token', env.githubToken ? `${yes} set` : `${opt} ${chalk.dim('unset — public scrape, lower rate limit')}`));
  console.log(ui.kv('LinkedIn live', env.linkedinCookie && playwright ? `${yes} cookie + Playwright` : `${opt} ${chalk.dim(`${env.linkedinCookie ? 'cookie set' : 'no cookie'}, ${playwright ? 'Playwright ready' : 'Playwright not installed'} — PDF fallback`)}`));

  // ---- toolchain -----------------------------------------------------------
  const latexmk = haveCmd('latexmk');
  const docker = haveCmd('docker');
  const daemon = docker && dockerDaemonUp();
  const canBuild = latexmk || daemon;
  console.log(ui.heading('LaTeX toolchain'));
  console.log(ui.kv('render', canBuild
    ? `${yes} ${latexmk ? 'local latexmk' : 'Docker'}`
    : `${no} ${chalk.red(docker ? 'Docker installed but daemon down — start Docker Desktop' : 'no latexmk or Docker')}`));

  // ---- scraped sources -----------------------------------------------------
  const lock = await readLock(root);
  const gh = await readJson(join(root, 'profile', 'github.json'));
  const li = await readJson(join(root, 'profile', 'linkedin.json'));
  console.log(ui.heading('Scraped sources'));
  console.log(ui.kv('GitHub', gh
    ? `${yes} ${chalk.dim(`${gh.totals?.publicRepos ?? '?'} repos · ${gh.totals?.totalStars ?? '?'}★ · ${gh.totals?.mergedPRs ?? '?'} merged PRs`)} ${chalk.dim(`· scraped ${timeAgo(lock.scrape?.github?.at)}`)}`
    : `${no} ${chalk.dim('not scraped yet — run sync')}`));
  console.log(ui.kv('LinkedIn', li
    ? `${yes} ${chalk.dim(`${li.profile?.experience?.length ?? '?'} roles · via ${li.via}`)} ${chalk.dim(`· scraped ${timeAgo(lock.scrape?.linkedin?.at)}`)}`
    : `${no} ${chalk.dim('not scraped yet — run sync')}`));

  const d = await drift(root);
  if (d.lock && !d.synced) console.log(ui.kv('drift', ui.warn(`${d.changed.join(', ')} changed since last sync`)));
  else if (d.lock) console.log(ui.kv('drift', `${yes} ${chalk.dim('in sync')}`));

  // ---- built résumé --------------------------------------------------------
  console.log(ui.heading('Canonical résumé'));
  const pdf = join(root, 'assets', 'resume.pdf');
  if (existsSync(pdf)) {
    const s = await stat(pdf);
    console.log(ui.kv('assets/resume.pdf', `${yes} ${chalk.dim(`${(s.size / 1024).toFixed(0)} KB · built ${timeAgo(s.mtime.toISOString())}`)}`));
  } else {
    console.log(ui.kv('assets/resume.pdf', `${opt} ${chalk.dim('not built — run `npm run build:pdf`')}`));
  }

  // ---- tailored outputs ----------------------------------------------------
  console.log(ui.heading('Tailored outputs'));
  const pdfs = await listPdfs(join(root, 'tailored'));
  if (!pdfs.length) console.log('  ' + chalk.dim('(none yet — run tailor)'));
  else for (const p of pdfs.slice(0, 12)) console.log(ui.kv(chalk.cyan(relative(join(root, 'tailored'), p.path).replace(/\\/g, '/')), chalk.dim(timeAgo(p.mtime))));
  console.log();
}

async function listPdfs(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) {
      const path = join(e.parentPath || e.path || dir, e.name);
      try { out.push({ path, mtime: (await stat(path)).mtime.toISOString() }); } catch { /* skip */ }
    }
  }
  return out.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
}
