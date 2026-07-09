// TailorService — the JD-tailoring pipeline as a domain service. It depends only
// on ports (LlmProvider, LatexCompiler, PdfInspector, Presenter) plus pure
// helpers, so it renders no vendor-specific or terminal-specific code itself. It
// returns a structured TailorRunResult; the CLI decides how to draw the report.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmProvider } from '../ports/llm.js';
import type { LatexCompiler, PdfInspector, EngineReason } from '../ports/latex.js';
import type { Presenter } from '../ports/logger.js';
import {
  extractJdKeywords, classify, scoreResume,
  boldify, latexEscape, replaceBlock, latexToPlainText,
} from './core.js';
import { drift } from '../profile/sources.js';
import { checkLog } from '../check/log.js';
import { outputPaths, extractRoleFromJd } from '../naming.js';
import { buildReportMarkdown, type TailorReportData } from './report.js';
import {
  tailorPrompt, tailorFixPrompt, TAILOR_SCHEMA, mapTailorResponse, type TailorResponse,
} from '../prompts.js';
import type { Facts, OutputPaths, Score } from '../types.js';
import type { SourceRefresher } from '../scrape/refresh.js';

export interface TailorRequest {
  jd: string;
  company: string;
  role?: string;
}

export interface TailorRunResult {
  paths: OutputPaths;
  score: Score;
  role: string;
  guardsPass: boolean;
  report: TailorReportData;
}

export interface TailorServiceDeps {
  root: string;
  latex: LatexCompiler;
  pdf: PdfInspector;
  presenter: Presenter;
}

// One tailoring run needs a provider + a refresher (both depend on the per-run
// provider selection), passed to run().
export interface TailorRunContext {
  provider: LlmProvider;
  refresher: SourceRefresher;
}

interface Guards {
  built: boolean;
  pages: number | null;
  width: string[];
}

interface TailorContent {
  summaryText: string;
  subtitle: string;
  boldTerms: string[];
}

// How many times to re-ask the model for a tighter draft when a guard fails.
const MAX_FIX_ATTEMPTS = 2;

function engineError(reason: EngineReason): Error {
  return reason === 'docker-daemon-down'
    ? new Error('Docker daemon is down — start Docker Desktop (or install latexmk).')
    : new Error('Need latexmk or Docker to render. Install one and retry.');
}

function guardsPass(g: Guards): boolean {
  return g.pages === 1 && g.width.length === 0;
}

function describeGuardFailure(g: Guards): string {
  const problems: string[] = [];
  if (g.pages !== 1) problems.push(`the résumé overflowed to ${g.pages} pages (it must be exactly 1)`);
  if (g.width.length) problems.push(`${g.width.length} line(s) overflow the text width`);
  return problems.join('; ');
}

function buildTailoredTex(resumeTex: string, { summaryText, subtitle, boldTerms }: TailorContent): string {
  const summaryLatex = '   ' + boldify(summaryText, boldTerms);
  const subtitleLatex = '    {\\large ' + subtitle.split(/\s*\|\s*/).map((s) => latexEscape(s.trim())).join(' $|$ ') + '} \\\\ \\vspace{4pt}';
  let out = resumeTex;
  out = replaceBlock(out, 'summary', summaryLatex);
  out = replaceBlock(out, 'subtitle', subtitleLatex);
  return out;
}

export class TailorService {
  constructor(private readonly deps: TailorServiceDeps) {}

  async run(request: TailorRequest, ctx: TailorRunContext): Promise<TailorRunResult> {
    const { root, latex, pdf, presenter } = this.deps;
    const { provider, refresher } = ctx;
    const { jd, company, role: roleOverride = '' } = request;

    if (!jd || jd.trim().length < 20) throw new Error('JD text looks too short to analyze.');
    if (!company || !company.trim()) throw new Error('No company given — pass --company "Acme AI".');

    // Fail fast if nothing can render the PDF, before spending any LLM call.
    const engineReason = latex.availability();
    if (engineReason) throw engineError(engineReason);

    const facts: Facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
    const resumeTex = await readFile(join(root, 'resume.tex'), 'utf8');
    const resumeText = latexToPlainText(resumeTex);

    // ---- keep scraped sources fresh (fail-soft) ---------------------------
    const spinS = presenter.spinner('Refreshing profile sources (GitHub, LinkedIn)…');
    const fresh = await refresher.ensureFresh(root, { log: (r) => { spinS.update(`Sources: ${r.source} ${r.status}…`); } });
    const changed = fresh.filter((r) => r.status === 'updated' || r.status === 'created');
    const errs = fresh.filter((r) => r.status === 'error');
    if (errs.length) spinS.warn(`Sources: ${errs.map((e) => `${e.source} (${e.error})`).join('; ')} — using cached data.`);
    else if (changed.length) spinS.succeed(`Sources refreshed: ${changed.map((c) => c.source).join(', ')}.`);
    else spinS.succeed('Profile sources fresh.');

    // ---- drift warning ----------------------------------------------------
    const d = await drift(root);
    if (!d.lock) presenter.note('No sync baseline yet — run `sync` after profile edits.');
    else if (!d.synced) presenter.warn(`Profile sources changed since last sync: ${d.changed.join(', ')}. Fact base may be stale.`);

    // ---- score ------------------------------------------------------------
    const jdKeywords = extractJdKeywords(jd);
    const cls = classify(jdKeywords, resumeText, facts);
    const score = scoreResume(cls);

    // ---- tailor content (LLM) --------------------------------------------
    const spin = presenter.spinner(`Asking ${provider.label} (${provider.model}) to tailor from your fact base…`);
    let roleTitle: string, summaryText: string, subtitle: string, boldTerms: string[], rationale: string;
    try {
      const parsed = await provider.generateJson<TailorResponse>({
        prompt: tailorPrompt({ jd, facts, classification: cls }),
        schema: TAILOR_SCHEMA,
      });
      ({ roleTitle, summaryText, subtitle, boldTerms, rationale } = mapTailorResponse(parsed));
      spin.succeed(`${provider.label} tailored the summary & subtitle.`);
    } catch (err) {
      spin.fail(`${provider.label} failed: ${(err as Error).message}`);
      throw new Error(`Check the ${provider.label} API key / quota / model name and retry.`);
    }

    // ---- resolve role + output paths -------------------------------------
    const role = roleOverride || roleTitle || extractRoleFromJd(jd) || 'Software Engineer';
    const fullName = facts.identity?.name || 'Sandeep Singh';
    const paths = outputPaths(root, { company, fullName, role });

    // ---- render + guards, with an agentic tighten-and-retry loop ----------
    await mkdir(paths.dir, { recursive: true });
    await mkdir(join(root, 'build'), { recursive: true });

    let content: TailorContent = { summaryText, subtitle, boldTerms };
    const spin2 = presenter.spinner('Rendering PDF & running guards…');
    let guards = await this.renderAndGuard(buildTailoredTex(resumeTex, content), paths);
    if (guardsPass(guards)) spin2.succeed('PDF rendered — guards passed.');
    else spin2.warn(`PDF rendered — guard failed: ${describeGuardFailure(guards)}.`);

    for (let attempt = 1; !guardsPass(guards) && attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      const problem = describeGuardFailure(guards);
      const summaryBudget = Math.max(160, 300 - attempt * 60);
      const spinFix = presenter.spinner(`Asking ${provider.label} to tighten the copy (fix ${attempt}/${MAX_FIX_ATTEMPTS})…`);
      try {
        const parsed = await provider.generateJson<TailorResponse>({
          prompt: tailorFixPrompt({ jd, facts, classification: cls, previous: content, problem, summaryBudget }),
          schema: TAILOR_SCHEMA,
        });
        const fixed = mapTailorResponse(parsed);
        content = { summaryText: fixed.summaryText, subtitle: fixed.subtitle, boldTerms: fixed.boldTerms };
        spinFix.succeed(`${provider.label} returned a tighter draft — re-rendering…`);
      } catch (err) {
        spinFix.fail(`${provider.label} fix attempt failed: ${(err as Error).message}`);
        break;
      }
      const spinR = presenter.spinner(`Re-rendering PDF & re-checking guards (fix ${attempt})…`);
      guards = await this.renderAndGuard(buildTailoredTex(resumeTex, content), paths);
      if (guardsPass(guards)) spinR.succeed(`Guards passed after ${attempt} fix attempt(s).`);
      else spinR.warn(`Still failing: ${describeGuardFailure(guards)}.`);
    }

    // The loop may have changed the copy — report on whatever finally rendered.
    ({ summaryText, subtitle } = content);
    const passed = guardsPass(guards);
    const report: TailorReportData = {
      cls, score, role, summaryText, subtitle, rationale,
      guards: { pages: guards.pages, width: guards.width },
      paths, guardsPass: passed, provider: provider.id, model: provider.model,
    };
    await writeFile(paths.report, buildReportMarkdown(report));
    return { paths, score, role, guardsPass: passed, report };
  }

  // Write the tailored .tex, compile it, and run the page/width guards.
  private async renderAndGuard(out: string, paths: OutputPaths): Promise<Guards> {
    const { root, latex, pdf } = this.deps;
    await writeFile(paths.tex, out);       // pretty source next to the PDF
    await writeFile(paths.buildTex, out);  // plain-jobname copy for pdflatex
    const res = latex.compile(root, paths.buildTexRel, { outDir: 'build', capture: true });
    const guards: Guards = { built: existsSync(paths.buildPdf), pages: null, width: [] };
    if (!guards.built) {
      if (res.reason === 'docker-daemon-down' || res.reason === 'no-engine') throw engineError(res.reason);
      throw new Error('Compilation error — check ' + paths.relDir + ' and the build log.');
    }
    await copyFile(paths.buildPdf, paths.pdf);
    const { totalPages } = await pdf.extract(paths.pdf);
    guards.pages = totalPages;
    guards.width = await checkLog(paths.buildLog, { maxOverfullPt: 2 });
    return guards;
  }
}
