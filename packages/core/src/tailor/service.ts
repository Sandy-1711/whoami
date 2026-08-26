// TailorService — the JD-tailoring pipeline as a domain service. It depends only
// on ports (Llm, LatexCompiler, PdfInspector, Presenter) plus pure helpers, so it
// renders no vendor-specific or terminal-specific code itself. It returns a
// structured TailorRunResult; the CLI decides how to draw the report.
//
// Two stages, because they have very different costs and failure modes:
//
//   plan()   refresh sources, score the JD, ask the model for copy. Minutes of
//            network and one model call; no Docker, nothing rendered. Saved to
//            tailored/<company>/tailor-plan.json.
//   render() write the .tex, compile, run the guards, and re-ask for tighter
//            copy when one fails. Needs a LaTeX toolchain.
//
// run() is both, which is what the CLI wants. A caller that must not sit on one
// long call — an MCP client near its timeout — calls them separately.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Llm } from '@resume/llm';
import { LlmError } from '@resume/llm';
import type { LatexCompiler, PdfInspector, EngineReason } from '../ports/latex.js';
import type { Presenter } from '../ports/logger.js';
import { extractJdKeywords, classify, scoreResume } from './core.js';
import { applyResumeEdit, type ResumeEdit, type RevertedEdit } from '../resume/edit.js';
import { renderResume } from '../resume/render.js';
import { resumePlainText, type Resume } from '../resume/schema.js';
import { loadResume } from '../resume/store.js';
import { drift } from '../profile/sources.js';
import { loadProfileDigestText } from '../profile/loaders.js';
import { checkLog } from '../check/log.js';
import { outputPaths, extractRoleFromJd } from '../naming.js';
import { buildReportMarkdown, type TailorReportData } from './report.js';
import {
  tailorPrompt, tailorFixPrompt, TAILOR_SCHEMA, mapTailorResponse,
} from '../prompts.js';
import type { Facts, OutputPaths, Score, Classification } from '../types.js';
import type { SourceRefresher } from '../scrape/refresh.js';

export interface TailorRequest {
  jd: string;
  company: string;
  role?: string;
}

// The rewrite the model produced, plus everything render() needs to compile it
// and to ask for a tighter draft without re-planning. Persisted between stages.
export interface TailorPlan {
  company: string;
  role: string;
  jd: string;
  edit: ResumeEdit;
  score: Score;
  cls: Classification;
  provider: string;
  model: string;
  createdAt: string;
}

export interface TailorPlanResult {
  plan: TailorPlan;
  paths: OutputPaths;
  // Where the plan was written, so render() can be pointed at it.
  planFile: string;
}

export interface TailorRunResult {
  paths: OutputPaths;
  /** `after` is measured on the résumé that rendered, not projected. */
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

// One tailoring run needs a model gateway + a refresher, passed to run().
export interface TailorRunContext {
  llm: Llm;
  refresher: SourceRefresher;
}

export interface TailorRenderContext {
  llm: Llm;
}

interface Guards {
  built: boolean;
  pages: number | null;
  width: string[];
}

// How many times to re-ask the model for a tighter draft when a guard fails.
const MAX_FIX_ATTEMPTS = 2;

const PLAN_FILE = 'tailor-plan.json';

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

// Roughly how much text has to go. A page is a lot; an overfull line is a
// phrase. The attempt number escalates it, so a draft that ignored the first
// ask is told to cut harder rather than the same amount again.
function charsToCut(g: Guards, attempt: number): number {
  const spill = Math.max(0, (g.pages ?? 1) - 1) * 200 + g.width.length * 40;
  return Math.max(80, spill) + (attempt - 1) * 150;
}

export class TailorService {
  constructor(private readonly deps: TailorServiceDeps) {}

  async run(request: TailorRequest, ctx: TailorRunContext): Promise<TailorRunResult> {
    // Fail before spending a model call if nothing could render the result.
    const engineReason = this.deps.latex.availability();
    if (engineReason) throw engineError(engineReason);

    const { plan } = await this.plan(request, ctx);
    return this.render(plan, { llm: ctx.llm });
  }

  /** Refresh sources, score the JD, and ask the model for tailored copy. */
  async plan(request: TailorRequest, ctx: TailorRunContext): Promise<TailorPlanResult> {
    const { root, presenter } = this.deps;
    const { llm, refresher } = ctx;
    const { jd, company, role: roleOverride = '' } = request;
    const model = llm.describe();

    if (!jd || jd.trim().length < 20) throw new Error('JD text looks too short to analyze.');
    if (!company || !company.trim()) throw new Error('No company given — pass --company "Acme AI".');

    const facts: Facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
    const resume = await loadResume(root);

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
    const cls = classify(extractJdKeywords(jd), resumePlainText(resume), facts);
    const score = scoreResume(cls);

    // Ranked GitHub/LinkedIn evidence (just refreshed above) so the model
    // emphasizes the strongest true facts. Empty when never synced.
    const digest = await loadProfileDigestText(root);

    // ---- tailor content (LLM) --------------------------------------------
    const spin = presenter.spinner(`Asking ${model.label} (${model.modelId}) to tailor from your fact base…`);
    let edit: ResumeEdit;
    try {
      const { object } = await llm.generateJson({
        operation: 'tailor',
        prompt: tailorPrompt({ jd, resume, facts, classification: cls, digest }),
        schema: TAILOR_SCHEMA,
      });
      edit = mapTailorResponse(object);
      spin.succeed(`${model.label} rewrote the summary, the subtitle and ${edit.bullets.length} bullet(s).`);
    } catch (err) {
      spin.fail(err instanceof LlmError ? err.describe() : (err as Error).message);
      throw err;
    }

    const role = roleOverride || edit.roleTitle || extractRoleFromJd(jd) || 'Software Engineer';
    const paths = outputPaths(root, { company, fullName: facts.identity?.name || 'Sandeep Singh', role });

    const plan: TailorPlan = {
      company, role, jd, edit, score, cls,
      provider: model.providerId,
      model: model.modelId,
      createdAt: new Date().toISOString(),
    };

    await mkdir(paths.dir, { recursive: true });
    const planFile = join(paths.dir, PLAN_FILE);
    await writeFile(planFile, JSON.stringify(plan, null, 2) + '\n');

    return { plan, paths, planFile };
  }

  /** Read back the plan saved for a company by {@link plan}. */
  async loadPlan(company: string, fullName?: string): Promise<TailorPlan> {
    const { root } = this.deps;
    const facts: Facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
    // The directory is keyed by company alone, so any role resolves the same one.
    const dir = outputPaths(root, { company, fullName: fullName || facts.identity?.name || 'Sandeep Singh', role: 'x' }).dir;
    const file = join(dir, PLAN_FILE);
    if (!existsSync(file)) {
      throw new Error(`No tailoring plan for "${company}" — run the planning step first (it writes ${PLAN_FILE}).`);
    }
    return JSON.parse(await readFile(file, 'utf8'));
  }

  /** Compile a plan into a PDF and run the guards, tightening the copy on failure. */
  async render(plan: TailorPlan, ctx: TailorRenderContext): Promise<TailorRunResult> {
    const { root, presenter } = this.deps;
    const { llm } = ctx;
    const model = llm.describe();

    const engineReason = this.deps.latex.availability();
    if (engineReason) throw engineError(engineReason);

    const facts: Facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
    const base = await loadResume(root);
    const paths = outputPaths(root, {
      company: plan.company,
      fullName: facts.identity?.name || 'Sandeep Singh',
      role: plan.role,
    });

    await mkdir(paths.dir, { recursive: true });
    await mkdir(join(root, 'build'), { recursive: true });

    const edit = applyResumeEdit(base, plan.edit, facts);
    let draft: Resume = edit.resume;
    const applied = new Set(edit.applied);
    const reverted = new Map(edit.reverted.map((r) => [r.id, r]));
    this.reportReverts(edit.reverted, edit.unknown);

    const spin2 = presenter.spinner('Rendering PDF & running guards…');
    let guards = await this.renderAndGuard(renderResume(draft), paths);
    if (guardsPass(guards)) spin2.succeed('PDF rendered — guards passed.');
    else spin2.warn(`PDF rendered — guard failed: ${describeGuardFailure(guards)}.`);

    for (let attempt = 1; !guardsPass(guards) && attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      const problem = describeGuardFailure(guards);
      const spinFix = presenter.spinner(`Asking ${model.label} to tighten the copy (fix ${attempt}/${MAX_FIX_ATTEMPTS})…`);
      try {
        const { object } = await llm.generateJson({
          operation: 'tailor-fix',
          prompt: tailorFixPrompt({
            jd: plan.jd, resume: draft, facts, classification: plan.cls,
            problem, overBy: charsToCut(guards, attempt),
          }),
          schema: TAILOR_SCHEMA,
        });
        const fix = applyResumeEdit(draft, mapTailorResponse(object), facts);
        draft = fix.resume;
        fix.applied.forEach((id) => applied.add(id));
        fix.reverted.forEach((r) => reverted.set(r.id, r));
        this.reportReverts(fix.reverted, fix.unknown);
        spinFix.succeed(`${model.label} returned a tighter draft — re-rendering…`);
      } catch (err) {
        spinFix.fail(err instanceof LlmError ? err.describe() : (err as Error).message);
        break;
      }
      const spinR = presenter.spinner(`Re-rendering PDF & re-checking guards (fix ${attempt})…`);
      guards = await this.renderAndGuard(renderResume(draft), paths);
      if (guardsPass(guards)) spinR.succeed(`Guards passed after ${attempt} fix attempt(s).`);
      else spinR.warn(`Still failing: ${describeGuardFailure(guards)}.`);
    }

    // The loop may have changed the copy — report on whatever finally rendered.
    const passed = guardsPass(guards);
    // scoreResume's "before" is coverage as the text stands. Run against the
    // résumé that actually rendered, that is a measurement rather than the
    // projection the plan made before the model had written anything.
    const rendered = classify(extractJdKeywords(plan.jd), resumePlainText(draft), facts);
    const score: Score = { ...plan.score, after: scoreResume(rendered).before };

    const report: TailorReportData = {
      cls: plan.cls,
      score,
      projectedAfter: plan.score.after,
      role: plan.role,
      summary: draft.summary,
      subtitle: draft.subtitle.join(' | '),
      edited: [...applied],
      reverted: [...reverted.values()],
      rationale: plan.edit.rationale,
      guards: { pages: guards.pages, width: guards.width },
      paths, guardsPass: passed, provider: plan.provider, model: plan.model,
    };
    await writeFile(paths.report, buildReportMarkdown(report));
    return { paths, score, role: plan.role, guardsPass: passed, report };
  }

  // A reverted line is not a failure — the guarantee working — but it is the one
  // thing about a run the user has to be told without reading the report.
  private reportReverts(reverted: RevertedEdit[], unknown: string[]): void {
    const { presenter } = this.deps;
    for (const { id, unbacked } of reverted) {
      presenter.warn(`Kept the original ${id}: the fact base does not back ${unbacked.join(', ')}.`);
    }
    if (unknown.length) presenter.note(`Ignored edits to unknown line(s): ${unknown.join(', ')}.`);
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
