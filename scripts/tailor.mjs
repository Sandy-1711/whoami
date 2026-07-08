#!/usr/bin/env node
// Tailor the résumé to a job description: score ATS keyword coverage, rewrite the
// summary/subtitle from a verified fact base with Gemini, render a JD-specific
// PDF named after the company + role, and run the same page/width guards as CI.
//
//   npm run tailor -- path/to/jd.txt --company "Inteligen-ai"
//   npm run tailor -- --jd "paste jd text..." --company acme --role "AI Dev Engineer"
//   npm run tailor -- --sync            # re-baseline the profile source hashes
//
// Gemini is required (needs GEMINI_API_KEY in .env). Scoring/keyword analysis is
// deterministic; only the phrasing + role extraction come from the model.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import ora from 'ora';
import {
  extractJdKeywords, classify, scoreResume,
  boldify, latexEscape, replaceBlock,
} from './lib/tailor-core.js';
import { drift, writeLock, hashSources } from './lib/sources.js';
import { compileLatex } from './lib/latex.js';
import { checkLog } from './lib/check-log.js';
import { outputPaths, extractRoleFromJd } from './lib/naming.js';
import * as ui from './lib/ui.js';
import { chalk } from './lib/ui.js';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, d) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : d; };
const MODEL = opt('--model', process.env.GEMINI_MODEL || 'gemini-2.5-flash');
// The résumé is named after the company + the role in the JD. --name stays as a
// backward-compatible alias for --company.
const COMPANY = opt('--company', opt('--name', ''));
const ROLE_OVERRIDE = opt('--role', '');
const VALUE_FLAGS = ['--name', '--company', '--model', '--jd', '--role'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]));

function die(msg) { console.error('\n' + ui.fail(msg) + '\n'); process.exit(1); }

async function main() {
  // ---- sync-only mode ------------------------------------------------------
  if (flag('--sync')) {
    const hashes = await hashSources(root);
    await writeLock(root, hashes);
    console.log('\n' + ui.ok('Profile sources re-baselined:'));
    for (const [k, v] of Object.entries(hashes)) console.log(ui.kv(k, v ? chalk.gray(v) : chalk.red('missing')));
    console.log();
    return;
  }

  // ---- load JD -------------------------------------------------------------
  let jd = opt('--jd', null);
  if (!jd) {
    const file = positional[0];
    if (!file) die('No JD given. Pass a file path, or --jd "text", or --sync.');
    if (!existsSync(file)) die(`JD file not found: ${file}`);
    jd = await readFile(file, 'utf8');
  }
  if (jd.trim().length < 20) die('JD text looks too short to analyze.');
  if (!COMPANY.trim()) die('No company given. Pass --company "Acme AI" so the résumé can be named + filed.');

  // Gemini is mandatory — no offline fallback.
  const key = process.env.GEMINI_API_KEY;
  if (!key) die('GEMINI_API_KEY not set. Add it to .env (see .env.example).');

  const facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
  const resumeTex = await readFile(join(root, 'resume.tex'), 'utf8');
  const resumeText = plainText(resumeTex);

  console.log(ui.banner('Résumé Tailor', `JD → ATS-optimized PDF · engine: gemini ${MODEL}`));

  // ---- sync drift warning --------------------------------------------------
  const d = await drift(root);
  if (!d.lock) console.log('\n' + ui.info(chalk.dim('No sync baseline yet — run `npm run tailor -- --sync` after profile edits.')));
  else if (!d.synced) console.log('\n' + ui.warn(`Profile sources changed since last sync: ${d.changed.join(', ')}. Fact base may be stale.`));

  // ---- score ---------------------------------------------------------------
  const jdKeywords = extractJdKeywords(jd);
  const cls = classify(jdKeywords, resumeText, facts);
  const score = scoreResume(cls);

  // ---- tailor content (Gemini) ---------------------------------------------
  const { tailorWithGemini } = await import('./lib/gemini.js');
  const spin = ora({ text: `Asking Gemini (${MODEL}) to tailor from your fact base…`, color: 'cyan' }).start();
  let roleTitle, summaryText, subtitle, boldTerms, rationale;
  try {
    ({ roleTitle, summaryText, subtitle, boldTerms, rationale } =
      await tailorWithGemini({ jd, facts, classification: cls, apiKey: key, model: MODEL }));
    spin.succeed('Gemini tailored the summary & subtitle.');
  } catch (err) {
    spin.fail(`Gemini failed: ${err.message}`);
    die('Check GEMINI_API_KEY / quota / model name and retry.');
  }

  // ---- resolve the role + output paths -------------------------------------
  // Priority: explicit --role > role the JD names (LLM, then heuristic) > fallback.
  const role = ROLE_OVERRIDE || roleTitle || extractRoleFromJd(jd) || 'Software Engineer';
  const fullName = facts.identity?.name || 'Sandeep Singh';
  const paths = outputPaths(root, { company: COMPANY, fullName, role });

  // ---- render tailored .tex ------------------------------------------------
  const summaryLatex = '   ' + boldify(summaryText, boldTerms);
  const subtitleLatex = '    {\\large ' + subtitle.split(/\s*\|\s*/).map((p) => latexEscape(p.trim())).join(' $|$ ') + '} \\\\ \\vspace{4pt}';
  let out = resumeTex;
  out = replaceBlock(out, 'summary', summaryLatex);
  out = replaceBlock(out, 'subtitle', subtitleLatex);

  await mkdir(paths.dir, { recursive: true });
  await mkdir(join(root, 'build'), { recursive: true });
  // Pretty, user-facing source next to the PDF …
  await writeFile(paths.tex, out);
  // … and a plain-jobname copy under build/ that pdflatex compiles happily.
  await writeFile(paths.buildTex, out);

  // ---- compile + guards ----------------------------------------------------
  const spin2 = ora({ text: 'Rendering PDF & running guards…', color: 'cyan' }).start();
  const res = compileLatex(root, paths.buildTexRel, { outDir: 'build', capture: true });
  const guards = { built: existsSync(paths.buildPdf), pages: null, width: [] };
  if (!guards.built) {
    spin2.fail('PDF build failed.');
    if (res.reason === 'docker-daemon-down') die('Docker daemon is down — start Docker Desktop (or install latexmk).');
    if (res.reason === 'no-engine') die('Need latexmk or Docker to render. Install one and retry.');
    die('Compilation error — check ' + paths.relDir + ' and the build log.');
  }
  await copyFile(paths.buildPdf, paths.pdf);
  const { extractPdf } = await import('./lib/extract-pdf.js');
  const { totalPages } = await extractPdf(paths.pdf);
  guards.pages = totalPages;
  guards.width = await checkLog(paths.buildLog, { maxOverfullPt: 2 });
  const guardsPass = guards.pages === 1 && guards.width.length === 0;
  guardsPass ? spin2.succeed('PDF rendered — guards passed.') : spin2.warn('PDF rendered — guard warnings (see below).');

  // ---- report --------------------------------------------------------------
  await report({ jdKeywords, cls, score, role, summaryText, subtitle, rationale, guards, paths, guardsPass });
}

// Strip LaTeX to plain-ish words for keyword matching.
function plainText(tex) {
  return tex
    .split('\n').filter((l) => !/^\s*%/.test(l)).join('\n')
    .replace(/\\href\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z]+\*?/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\s+/g, ' ');
}

async function report({ jdKeywords, cls, score, role, summaryText, subtitle, rationale, guards, paths, guardsPass }) {
  const pdfRel = relative(root, paths.pdf).replace(/\\/g, '/');
  const L = [];
  L.push(ui.heading('ATS coverage'));
  L.push('\n' + ui.scoreTable(score.before, score.after));
  L.push('');
  L.push(ui.gauge('current', score.before));
  L.push(ui.gauge('tailored', score.after));

  L.push(ui.heading(`Matched — already in your résumé (${cls.matched.length})`));
  L.push(ui.chips(cls.matched, 'good'));
  L.push(ui.heading(`Surface these — TRUE & JD-relevant, add to lift the score (${cls.addable.length})`));
  L.push(ui.chips(cls.addable, 'add'));
  L.push(ui.heading(`Gaps — JD wants, not in your fact base (don't fake) (${cls.missing.length})`));
  L.push(ui.chips(cls.missing, 'bad'));

  L.push(ui.heading('Detected role'));
  L.push('  ' + chalk.cyan(role));
  L.push(ui.heading('Tailored summary'));
  L.push('  ' + chalk.italic(summaryText));
  L.push(ui.heading('Tailored subtitle'));
  L.push('  ' + chalk.italic(subtitle));
  if (rationale) { L.push(ui.heading('Why (Gemini)')); L.push('  ' + chalk.dim(rationale)); }

  L.push(ui.heading('Output'));
  L.push(ui.kv('company', chalk.cyan(paths.slug)));
  L.push(ui.kv('pdf', chalk.cyan(pdfRel)));
  L.push(ui.kv('pages', guards.pages === 1 ? ui.ok('1') : ui.fail(`${guards.pages} (must be 1)`)));
  L.push(ui.kv('width', guards.width.length === 0 ? ui.ok('no overflow') : ui.fail(guards.width.join('; '))));

  L.push('\n' + (guardsPass
    ? ui.ok(chalk.green(`Done. Open "${pdfRel}" — ATS ${score.before} → ${score.after}.`))
    : ui.warn('Tailored PDF built but a guard failed — fix before sending.')));
  console.log(L.join('\n') + '\n');

  // Persist a markdown report next to the PDF.
  const md = [
    `# Tailored résumé report — ${paths.base}`,
    ``, `- ATS score: **${score.before} → ${score.after}** (target 92+)`,
    `- Role: ${role}`,
    `- Engine: gemini ${MODEL}`,
    `- Pages: ${guards.pages} · Width: ${guards.width.length === 0 ? 'OK' : guards.width.join('; ')}`,
    ``, `## Matched (${cls.matched.length})`, cls.matched.join(', ') || '(none)',
    ``, `## Surface — true & relevant (${cls.addable.length})`, cls.addable.join(', ') || '(none)',
    ``, `## Gaps — do not fabricate (${cls.missing.length})`, cls.missing.join(', ') || '(none)',
    ``, `## Tailored summary`, summaryText,
    ``, `## Tailored subtitle`, subtitle,
    rationale ? `\n## Rationale\n${rationale}` : '',
  ].join('\n');
  await writeFile(paths.report, md + '\n');
}

main().catch((e) => die(e.stack || e.message));
