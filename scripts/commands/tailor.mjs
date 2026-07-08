// `resume tailor` — score the résumé against a JD, rewrite the summary/subtitle
// with Gemini from the verified fact base, render a company/role-named PDF, and
// run the same page/width guards as CI. Exposed as runTailor() so both the CLI
// and interactive menu drive it.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import ora from 'ora';
import { root } from '../lib/root.js';
import { env } from '../lib/env.js';
import {
  extractJdKeywords, classify, scoreResume,
  boldify, latexEscape, replaceBlock,
} from '../lib/tailor/core.js';
import { drift } from '../lib/sources.js';
import { ensureFresh } from '../lib/scrape/refresh.js';
import { compileLatex } from '../lib/latex.js';
import { checkLog } from '../lib/check/log.js';
import { extractPdf } from '../lib/check/pdf.js';
import { tailorWithGemini } from '../lib/tailor/gemini.js';
import { outputPaths, extractRoleFromJd } from '../lib/naming.js';
import * as ui from '../lib/ui.js';
import { chalk } from '../lib/ui.js';

export async function runTailor({ jd, company, role: roleOverride = '', model = env.geminiModel } = {}) {
  if (!jd || jd.trim().length < 20) throw new Error('JD text looks too short to analyze.');
  if (!company || !company.trim()) throw new Error('No company given — pass --company "Acme AI".');
  const key = env.geminiKey;
  if (!key) throw new Error('GEMINI_API_KEY not set. Add it to .env (see .env.example).');

  const facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
  const resumeTex = await readFile(join(root, 'resume.tex'), 'utf8');
  const resumeText = plainText(resumeTex);

  console.log(ui.banner('Résumé Tailor', `JD → ATS-optimized PDF · engine: gemini ${model}`));

  // ---- keep scraped sources fresh (fail-soft) ------------------------------
  const spinS = ora({ text: 'Refreshing profile sources (GitHub, LinkedIn)…', color: 'cyan' }).start();
  const fresh = await ensureFresh(root, { log: (r) => { spinS.text = `Sources: ${r.source} ${r.status}…`; } });
  const changed = fresh.filter((r) => r.status === 'updated' || r.status === 'created');
  const errs = fresh.filter((r) => r.status === 'error');
  if (errs.length) spinS.warn(`Sources: ${errs.map((e) => `${e.source} (${e.error})`).join('; ')} — using cached data.`);
  else if (changed.length) spinS.succeed(`Sources refreshed: ${changed.map((c) => c.source).join(', ')}.`);
  else spinS.succeed('Profile sources fresh.');

  // ---- drift warning -------------------------------------------------------
  const d = await drift(root);
  if (!d.lock) console.log('\n' + ui.info(chalk.dim('No sync baseline yet — run `npm run sync` after profile edits.')));
  else if (!d.synced) console.log('\n' + ui.warn(`Profile sources changed since last sync: ${d.changed.join(', ')}. Fact base may be stale.`));

  // ---- score ---------------------------------------------------------------
  const jdKeywords = extractJdKeywords(jd);
  const cls = classify(jdKeywords, resumeText, facts);
  const score = scoreResume(cls);

  // ---- tailor content (Gemini) ---------------------------------------------
  const spin = ora({ text: `Asking Gemini (${model}) to tailor from your fact base…`, color: 'cyan' }).start();
  let roleTitle, summaryText, subtitle, boldTerms, rationale;
  try {
    ({ roleTitle, summaryText, subtitle, boldTerms, rationale } =
      await tailorWithGemini({ jd, facts, classification: cls, apiKey: key, model }));
    spin.succeed('Gemini tailored the summary & subtitle.');
  } catch (err) {
    spin.fail(`Gemini failed: ${err.message}`);
    throw new Error('Check GEMINI_API_KEY / quota / model name and retry.');
  }

  // ---- resolve role + output paths -----------------------------------------
  const role = roleOverride || roleTitle || extractRoleFromJd(jd) || 'Software Engineer';
  const fullName = facts.identity?.name || 'Sandeep Singh';
  const paths = outputPaths(root, { company, fullName, role });

  // ---- render tailored .tex ------------------------------------------------
  const summaryLatex = '   ' + boldify(summaryText, boldTerms);
  const subtitleLatex = '    {\\large ' + subtitle.split(/\s*\|\s*/).map((p) => latexEscape(p.trim())).join(' $|$ ') + '} \\\\ \\vspace{4pt}';
  let out = resumeTex;
  out = replaceBlock(out, 'summary', summaryLatex);
  out = replaceBlock(out, 'subtitle', subtitleLatex);

  await mkdir(paths.dir, { recursive: true });
  await mkdir(join(root, 'build'), { recursive: true });
  await writeFile(paths.tex, out);       // pretty source next to the PDF
  await writeFile(paths.buildTex, out);  // plain-jobname copy for pdflatex

  // ---- compile + guards ----------------------------------------------------
  const spin2 = ora({ text: 'Rendering PDF & running guards…', color: 'cyan' }).start();
  const res = compileLatex(root, paths.buildTexRel, { outDir: 'build', capture: true });
  const guards = { built: existsSync(paths.buildPdf), pages: null, width: [] };
  if (!guards.built) {
    spin2.fail('PDF build failed.');
    if (res.reason === 'docker-daemon-down') throw new Error('Docker daemon is down — start Docker Desktop (or install latexmk).');
    if (res.reason === 'no-engine') throw new Error('Need latexmk or Docker to render. Install one and retry.');
    throw new Error('Compilation error — check ' + paths.relDir + ' and the build log.');
  }
  await copyFile(paths.buildPdf, paths.pdf);
  const { totalPages } = await extractPdf(paths.pdf);
  guards.pages = totalPages;
  guards.width = await checkLog(paths.buildLog, { maxOverfullPt: 2 });
  const guardsPass = guards.pages === 1 && guards.width.length === 0;
  guardsPass ? spin2.succeed('PDF rendered — guards passed.') : spin2.warn('PDF rendered — guard warnings (see below).');

  await report({ jdKeywords, cls, score, role, summaryText, subtitle, rationale, guards, paths, guardsPass, model });
  return { paths, score, role, guardsPass };
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

async function report({ jdKeywords, cls, score, role, summaryText, subtitle, rationale, guards, paths, guardsPass, model }) {
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

  const md = [
    `# Tailored résumé report — ${paths.base}`,
    ``, `- ATS score: **${score.before} → ${score.after}** (target 92+)`,
    `- Role: ${role}`,
    `- Engine: gemini ${model}`,
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
