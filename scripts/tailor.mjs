#!/usr/bin/env node
// Tailor the résumé to a job description: score ATS keyword coverage, rewrite the
// summary/subtitle from a verified fact base (Gemini or offline), render a
// JD-specific PDF, and run the same page/width guards as CI.
//
//   npm run tailor -- path/to/jd.txt --name acme-ai
//   npm run tailor -- --jd "paste jd text..." --name acme --offline
//   npm run tailor -- --sync            # re-baseline the profile source hashes
//
// Engine: Gemini by default (needs GEMINI_API_KEY). --offline uses the
// deterministic engine (no key, no network).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ora from 'ora';
import {
  extractJdKeywords, classify, scoreResume, offlineSummary,
  boldify, latexEscape, replaceBlock, leadTitle, rankByPriority,
} from './lib/tailor-core.js';
import { drift, writeLock, hashSources } from './lib/sources.js';
import { compileLatex } from './lib/latex.js';
import { checkLog } from './lib/check-log.js';
import * as ui from './lib/ui.js';
import { chalk } from './lib/ui.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, d) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : d; };
const OFFLINE = flag('--offline');
const MODEL = opt('--model', process.env.GEMINI_MODEL || 'gemini-2.5-flash');
const NAME = opt('--name', 'tailored');
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--name' && argv[i - 1] !== '--model' && argv[i - 1] !== '--jd');

function die(msg) { console.error('\n' + ui.fail(msg) + '\n'); process.exit(1); }

// ---- sync-only mode --------------------------------------------------------
async function main() {
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
  if (jd.trim().length < 40) die('JD text looks too short to analyze.');

  const facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
  const resumeTex = await readFile(join(root, 'resume.tex'), 'utf8');
  const resumeText = plainText(resumeTex);

  console.log(ui.banner('Résumé Tailor', `JD → ATS-optimized PDF · engine: ${OFFLINE ? 'offline' : 'gemini ' + MODEL}`));

  // ---- sync drift warning --------------------------------------------------
  const d = await drift(root);
  if (!d.lock) console.log('\n' + ui.info(chalk.dim('No sync baseline yet — run `npm run tailor -- --sync` after profile edits.')));
  else if (!d.synced) console.log('\n' + ui.warn(`Profile sources changed since last sync: ${d.changed.join(', ')}. Fact base may be stale.`));

  // ---- score ---------------------------------------------------------------
  const jdKeywords = extractJdKeywords(jd);
  const cls = classify(jdKeywords, resumeText, facts);
  const score = scoreResume(cls);

  // ---- tailor content ------------------------------------------------------
  let summaryText, subtitle, boldTerms, rationale = '';
  if (OFFLINE) {
    summaryText = offlineSummary(facts, jdKeywords);
    subtitle = offlineSubtitle(facts, jdKeywords, cls);
    boldTerms = facts.headline_metrics.filter((m) => summaryText.includes(m));
  } else {
    const key = process.env.GEMINI_API_KEY;
    if (!key) die('GEMINI_API_KEY not set. Export it, or re-run with --offline.');
    const { tailorWithGemini } = await import('./lib/gemini.js');
    const spin = ora({ text: `Asking Gemini (${MODEL}) to tailor from your fact base…`, color: 'cyan' }).start();
    try {
      ({ summaryText, subtitle, boldTerms, rationale } = await tailorWithGemini({ jd, facts, classification: cls, apiKey: key, model: MODEL }));
      spin.succeed('Gemini tailored the summary & subtitle.');
    } catch (err) {
      spin.fail(`Gemini failed: ${err.message}`);
      die('Re-run with --offline to use the deterministic engine.');
    }
  }

  // ---- render tailored .tex ------------------------------------------------
  const summaryLatex = '   ' + boldify(summaryText, boldTerms);
  const subtitleLatex = '    {\\large ' + subtitle.split(/\s*\|\s*/).map((p) => latexEscape(p.trim())).join(' $|$ ') + '} \\\\ \\vspace{4pt}';
  let out = resumeTex;
  out = replaceBlock(out, 'summary', summaryLatex);
  out = replaceBlock(out, 'subtitle', subtitleLatex);

  await mkdir(join(root, 'tailored'), { recursive: true });
  const texRel = `tailored/${NAME}.tex`;
  await writeFile(join(root, texRel), out);

  // ---- compile + guards ----------------------------------------------------
  const spin2 = ora({ text: 'Rendering PDF & running guards…', color: 'cyan' }).start();
  const res = compileLatex(root, texRel, { outDir: 'tailored', capture: true });
  const pdfPath = join(root, 'tailored', `${NAME}.pdf`);
  const logPath = join(root, 'tailored', `${NAME}.log`);
  const guards = { built: existsSync(pdfPath), pages: null, width: [] };
  if (!guards.built) {
    spin2.fail('PDF build failed.');
    if (res.reason === 'docker-daemon-down') die('Docker daemon is down — start Docker Desktop (or install latexmk).');
    if (res.reason === 'no-engine') die('Need latexmk or Docker to render. Install one and retry.');
    die('Compilation error — check ' + texRel + ' and the log.');
  }
  const { extractPdf } = await import('./lib/extract-pdf.js');
  const { totalPages } = await extractPdf(pdfPath);
  guards.pages = totalPages;
  guards.width = await checkLog(logPath, { maxOverfullPt: 2 });
  const guardsPass = guards.pages === 1 && guards.width.length === 0;
  guardsPass ? spin2.succeed('PDF rendered — guards passed.') : spin2.warn('PDF rendered — guard warnings (see below).');

  // ---- report --------------------------------------------------------------
  await report({ jd, jdKeywords, cls, score, summaryText, subtitle, rationale, guards, texRel, pdfPath, guardsPass });
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

function offlineSubtitle(facts, jdKeywords, cls) {
  const lead = leadTitle(jdKeywords);
  const picks = rankByPriority([...cls.matched, ...cls.addable]).filter((k) => k !== lead).slice(0, 2).map(titleize);
  return [lead, ...picks, 'Open-Source Contributor'].slice(0, 3).join(' | ');
}

// Title-case for the subtitle, preserving all-caps acronyms (RAG, LLM, API, CI/CD).
function titleize(s) {
  return s.split(' ').map((w) => (/^[A-Z0-9/+.#]+$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}

async function report({ jd, jdKeywords, cls, score, summaryText, subtitle, rationale, guards, texRel, pdfPath, guardsPass }) {
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

  L.push(ui.heading('Tailored summary'));
  L.push('  ' + chalk.italic(summaryText));
  L.push(ui.heading('Tailored subtitle'));
  L.push('  ' + chalk.italic(subtitle));
  if (rationale) { L.push(ui.heading('Why (Gemini)')); L.push('  ' + chalk.dim(rationale)); }

  L.push(ui.heading('Output'));
  L.push(ui.kv('source', chalk.cyan(texRel)));
  L.push(ui.kv('pdf', chalk.cyan('tailored/' + pdfPath.split(/[\\/]/).pop())));
  L.push(ui.kv('pages', guards.pages === 1 ? ui.ok('1') : ui.fail(`${guards.pages} (must be 1)`)));
  L.push(ui.kv('width', guards.width.length === 0 ? ui.ok('no overflow') : ui.fail(guards.width.join('; '))));

  L.push('\n' + (guardsPass
    ? ui.ok(chalk.green(`Done. Open tailored/${pdfPath.split(/[\\/]/).pop()} — ATS ${score.before} → ${score.after}.`))
    : ui.warn('Tailored PDF built but a guard failed — fix before sending.')));
  console.log(L.join('\n') + '\n');

  // Persist a markdown report next to the PDF.
  const md = [
    `# Tailored résumé report — ${NAME}`,
    ``, `- ATS score: **${score.before} → ${score.after}** (target 92+)`,
    `- Engine: ${OFFLINE ? 'offline' : 'gemini ' + MODEL}`,
    `- Pages: ${guards.pages} · Width: ${guards.width.length === 0 ? 'OK' : guards.width.join('; ')}`,
    ``, `## Matched (${cls.matched.length})`, cls.matched.join(', ') || '(none)',
    ``, `## Surface — true & relevant (${cls.addable.length})`, cls.addable.join(', ') || '(none)',
    ``, `## Gaps — do not fabricate (${cls.missing.length})`, cls.missing.join(', ') || '(none)',
    ``, `## Tailored summary`, summaryText,
    ``, `## Tailored subtitle`, subtitle,
    rationale ? `\n## Rationale\n${rationale}` : '',
  ].join('\n');
  await writeFile(join(root, 'tailored', `${NAME}.report.md`), md + '\n');
}

main().catch((e) => die(e.stack || e.message));
