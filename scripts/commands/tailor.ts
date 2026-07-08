// `resume tailor` — score the résumé against a JD, rewrite the summary/subtitle
// with Gemini from the verified fact base, render a company/role-named PDF, and
// run the same page/width guards as CI. Exposed as runTailor() so both the CLI
// and interactive menu drive it.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { root } from '../lib/root.js';
import { env } from '../lib/env.js';
import {
  extractJdKeywords, classify, scoreResume,
  boldify, latexEscape, replaceBlock, latexToPlainText,
} from '../lib/tailor/core.js';
import { drift } from '../lib/sources.js';
import { ensureFresh } from '../lib/scrape/refresh.js';
import { compileLatex } from '../lib/latex.js';
import { checkLog } from '../lib/check/log.js';
import { extractPdf } from '../lib/check/pdf.js';
import { geminiJson } from '../lib/gemini.js';
import { tailorPrompt, TAILOR_SCHEMA, mapTailorResponse, type TailorResponse } from '../lib/prompts.js';
import { outputPaths, extractRoleFromJd } from '../lib/naming.js';
import { writeTailorReport } from '../lib/tailor/report.js';
import * as ui from '../lib/ui.js';
import { pc } from '../lib/ui.js';
import type { Facts, OutputPaths, Score } from '../lib/types.js';

export interface RunTailorArgs {
  jd: string;
  company: string;
  role?: string;
  model?: string;
}

export interface RunTailorResult {
  paths: OutputPaths;
  score: Score;
  role: string;
  guardsPass: boolean;
}

interface Guards {
  built: boolean;
  pages: number | null;
  width: string[];
}

export async function runTailor(
  { jd, company, role: roleOverride = '', model = env.geminiModel }: RunTailorArgs,
): Promise<RunTailorResult> {
  if (!jd || jd.trim().length < 20) throw new Error('JD text looks too short to analyze.');
  if (!company || !company.trim()) throw new Error('No company given — pass --company "Acme AI".');
  const key = env.geminiKey;
  if (!key) throw new Error('GEMINI_API_KEY not set. Add it to .env (see .env.example).');

  const facts: Facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
  const resumeTex = await readFile(join(root, 'resume.tex'), 'utf8');
  const resumeText = latexToPlainText(resumeTex);

  console.log(ui.banner('Résumé Tailor', `JD → ATS-optimized PDF · engine: gemini ${model}`));

  // ---- keep scraped sources fresh (fail-soft) ------------------------------
  const spinS = ui.spinner('Refreshing profile sources (GitHub, LinkedIn)…');
  const fresh = await ensureFresh(root, { log: (r) => { spinS.text = `Sources: ${r.source} ${r.status}…`; } });
  const changed = fresh.filter((r) => r.status === 'updated' || r.status === 'created');
  const errs = fresh.filter((r) => r.status === 'error');
  if (errs.length) spinS.warn(`Sources: ${errs.map((e) => `${e.source} (${e.error})`).join('; ')} — using cached data.`);
  else if (changed.length) spinS.succeed(`Sources refreshed: ${changed.map((c) => c.source).join(', ')}.`);
  else spinS.succeed('Profile sources fresh.');

  // ---- drift warning -------------------------------------------------------
  const d = await drift(root);
  if (!d.lock) console.log('\n' + ui.info(pc.dim('No sync baseline yet — run `npm run sync` after profile edits.')));
  else if (!d.synced) console.log('\n' + ui.warn(`Profile sources changed since last sync: ${d.changed.join(', ')}. Fact base may be stale.`));

  // ---- score ---------------------------------------------------------------
  const jdKeywords = extractJdKeywords(jd);
  const cls = classify(jdKeywords, resumeText, facts);
  const score = scoreResume(cls);

  // ---- tailor content (Gemini) ---------------------------------------------
  const spin = ui.spinner(`Asking Gemini (${model}) to tailor from your fact base…`);
  let roleTitle: string, summaryText: string, subtitle: string, boldTerms: string[], rationale: string;
  try {
    const parsed = await geminiJson<TailorResponse>({
      prompt: tailorPrompt({ jd, facts, classification: cls }),
      schema: TAILOR_SCHEMA,
      apiKey: key,
      model,
    });
    ({ roleTitle, summaryText, subtitle, boldTerms, rationale } = mapTailorResponse(parsed));
    spin.succeed('Gemini tailored the summary & subtitle.');
  } catch (err) {
    spin.fail(`Gemini failed: ${(err as Error).message}`);
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
  const spin2 = ui.spinner('Rendering PDF & running guards…');
  const res = compileLatex(root, paths.buildTexRel, { outDir: 'build', capture: true });
  const guards: Guards = { built: existsSync(paths.buildPdf), pages: null, width: [] };
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
  if (guardsPass) spin2.succeed('PDF rendered — guards passed.');
  else spin2.warn('PDF rendered — guard warnings (see below).');

  await writeTailorReport({ cls, score, role, summaryText, subtitle, rationale, guards, paths, guardsPass, model });
  return { paths, score, role, guardsPass };
}
