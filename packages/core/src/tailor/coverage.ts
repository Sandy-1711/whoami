// CoverageTailorService — the evidence-based tailoring pipeline (architecture
// Layers 5-7), the v2 that replaces the summary-only TailorService for résumés
// whose bullet groups carry TAILOR anchors.
//
// Flow: parse the JD into a requirement graph → load the curated evidence store →
// embed claims + requirements → per résumé entry, score units against the
// requirements, greedily select the best-covering set within a bullet budget, and
// have the grounded writer draft bullets from ONLY those units → verify
// groundedness → render into the entry's anchor → run the page/width guards,
// shrinking bullet budgets and re-rendering on overflow → emit a build lockfile.
//
// Pure orchestration over ports (LlmProvider, Embedder, LatexCompiler,
// PdfInspector, Presenter); the CLI/agent supply concrete adapters.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmProvider } from '../ports/llm.js';
import type { Embedder } from '../ports/embedding.js';
import type { LatexCompiler, PdfInspector, EngineReason } from '../ports/latex.js';
import type { Presenter } from '../ports/logger.js';
import type { Facts, OutputPaths, Score } from '../types.js';
import {
  extractJdKeywords, classify, scoreResume, boldify, latexEscape, replaceBlock, latexToPlainText,
} from './core.js';
import { tailorPrompt, TAILOR_SCHEMA, mapTailorResponse, type TailorResponse } from '../prompts.js';
import { buildReportMarkdown, type TailorReportData } from './report.js';
import { outputPaths, extractRoleFromJd } from '../naming.js';
import { checkLog } from '../check/log.js';
import { drift } from '../profile/sources.js';
import { readEvidence, readCuration, curatedUnits, type EvidenceUnit } from '../evidence/store.js';
import { parseRequirements, type Requirement, type RequirementGraph } from '../evidence/requirements.js';
import { embedClaims } from '../evidence/embedding.js';
import { readWeights, buildRelevanceMatrix, type Weights } from '../evidence/relevance.js';
import { selectCoverage } from '../evidence/selector.js';
import { writeBullets, checkGroundedness, type DraftBullet } from '../evidence/writer.js';
import { RESUME_ANCHORS, groupUnitsByAnchor, type AnchorSpec } from '../evidence/anchors.js';
import {
  writeBuildLock, hashWeights, hashTemplate, buildLockPath,
  BUILD_LOCK_VERSION, type BuildLock, type LockedUnit,
} from '../evidence/lockfile.js';
import type { SourceRefresher } from '../scrape/refresh.js';

export interface CoverageTailorRequest {
  jd: string;
  company: string;
  role?: string;
}

export interface CoverageTailorResult {
  paths: OutputPaths;
  role: string;
  score: Score;
  coverageScore: number;
  guardsPass: boolean;
  lockPath: string;
  selectedCount: number;
  report: TailorReportData;
}

export interface CoverageTailorDeps {
  root: string;
  latex: LatexCompiler;
  pdf: PdfInspector;
  presenter: Presenter;
}

export interface CoverageTailorContext {
  provider: LlmProvider;
  embedder: Embedder;
  refresher?: SourceRefresher;
  now?: Date;
}

interface Guards {
  built: boolean;
  pages: number | null;
  width: string[];
}

// A drafted, grounded bullet plus the unit + score that back it (for the lockfile).
interface AnchoredBullet {
  bullet: DraftBullet;
  unit: EvidenceUnit;
  score: number;
  anchor: string;
}

const MAX_SHRINK_ATTEMPTS = 3;

function engineError(reason: EngineReason): Error {
  return reason === 'docker-daemon-down'
    ? new Error('Docker daemon is down — start Docker Desktop (or install latexmk).')
    : new Error('Need latexmk or Docker to render. Install one and retry.');
}

const guardsPass = (g: Guards): boolean => g.pages === 1 && g.width.length === 0;

function describeGuardFailure(g: Guards): string {
  const p: string[] = [];
  if (g.pages !== 1) p.push(`overflowed to ${g.pages} pages (must be 1)`);
  if (g.width.length) p.push(`${g.width.length} line(s) overflow the text width`);
  return p.join('; ');
}

export class CoverageTailorService {
  constructor(private readonly deps: CoverageTailorDeps) {}

  async run(request: CoverageTailorRequest, ctx: CoverageTailorContext): Promise<CoverageTailorResult> {
    const { root, latex, presenter } = this.deps;
    const { provider, embedder } = ctx;
    const now = ctx.now ?? new Date();
    const { jd, company, role: roleOverride = '' } = request;

    if (!jd || jd.trim().length < 20) throw new Error('JD text looks too short to analyze.');
    if (!company || !company.trim()) throw new Error('No company given — pass --company "Acme AI".');
    const engineReason = latex.availability();
    if (engineReason) throw engineError(engineReason);

    const facts: Facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
    const resumeTex = await readFile(join(root, 'resume.tex'), 'utf8');
    const resumeText = latexToPlainText(resumeTex);

    const store = await readEvidence(root);
    if (!store.units.length) throw new Error('Evidence store is empty — run `resume ingest` first.');
    const curation = await readCuration(root);
    const units = curatedUnits(store, curation);
    const weights = await readWeights(root);

    // Keep sources fresh (fail-soft) + drift note, mirroring v1.
    if (ctx.refresher) {
      const spinS = presenter.spinner('Refreshing profile sources…');
      try {
        const fresh = await ctx.refresher.ensureFresh(root, { log: (r) => spinS.update(`Sources: ${r.source} ${r.status}…`) });
        const errs = fresh.filter((r) => r.status === 'error');
        if (errs.length) spinS.warn(`Sources: ${errs.map((e) => e.source).join(', ')} failed — using cached data.`);
        else spinS.succeed('Profile sources fresh.');
      } catch { spinS.warn('Source refresh skipped.'); }
    }
    const d = await drift(root);
    if (d.lock && !d.synced) presenter.warn(`Sources changed since last sync: ${d.changed.join(', ')}. Re-run ingest if the fact base moved.`);

    // ---- ATS score (deterministic continuity metric) ----------------------
    const jdKeywords = extractJdKeywords(jd);
    const cls = classify(jdKeywords, resumeText, facts);
    const score = scoreResume(cls);

    // ---- requirement graph ------------------------------------------------
    const spinR = presenter.spinner(`Parsing the JD into a requirement graph (${provider.label})…`);
    let graph: RequirementGraph;
    try {
      graph = await parseRequirements(jd, provider);
      spinR.succeed(`Requirements: ${graph.must_have.length} must-have, ${graph.nice_to_have.length} nice-to-have.`);
    } catch (err) {
      spinR.fail(`Requirement parse failed: ${(err as Error).message}`);
      throw err;
    }
    const requirements: Requirement[] = [...graph.must_have, ...graph.nice_to_have];

    // ---- embeddings -------------------------------------------------------
    const spinE = presenter.spinner('Embedding evidence claims + requirements…');
    let unitVec: Map<string, number[]>;
    let reqVectors: number[][];
    try {
      const claimVectors = await embedClaims(root, units.map((u) => u.claim), embedder);
      unitVec = new Map(units.map((u, i) => [u.id, claimVectors[i]]));
      reqVectors = requirements.length ? await embedder.embed(requirements.map((r) => r.req)) : [];
      spinE.succeed(`Embedded ${units.length} claims.`);
    } catch (err) {
      spinE.fail(`Embedding failed: ${(err as Error).message}`);
      throw err;
    }

    // ---- per-anchor select + write (LLM writer once, at full budget) -------
    const groups = groupUnitsByAnchor(units);
    const anchored: Map<string, AnchoredBullet[]> = new Map();
    let coverageScore = 0;

    const spinW = presenter.spinner('Selecting evidence and writing grounded bullets…');
    try {
      for (const spec of RESUME_ANCHORS) {
        const groupUnits = groups.get(spec.anchor) ?? [];
        if (!groupUnits.length) { anchored.set(spec.anchor, []); continue; }
        const bullets = await this.selectAndWrite(spec, groupUnits, requirements, unitVec, reqVectors, weights, graph.ats_keywords, provider, now);
        anchored.set(spec.anchor, bullets);
        coverageScore += bullets.reduce((s, b) => s + b.score, 0);
      }
      const total = [...anchored.values()].reduce((n, b) => n + b.length, 0);
      spinW.succeed(`Wrote ${total} grounded bullets across ${RESUME_ANCHORS.length} entries.`);
    } catch (err) {
      spinW.fail(`Selection/writing failed: ${(err as Error).message}`);
      throw err;
    }

    // ---- summary + subtitle (grounded in facts, reusing the v1 prompt) -----
    let summaryLatex = replaceMarker(resumeTex, 'summary');
    let subtitleLatex = replaceMarker(resumeTex, 'subtitle');
    try {
      const parsed = await provider.generateJson<TailorResponse>({ prompt: tailorPrompt({ jd, facts, classification: cls }), schema: TAILOR_SCHEMA });
      const t = mapTailorResponse(parsed);
      summaryLatex = '   ' + boldify(t.summaryText, t.boldTerms);
      subtitleLatex = '    {\\large ' + t.subtitle.split(/\s*\|\s*/).map((s) => latexEscape(s.trim())).join(' $|$ ') + '} \\\\ \\vspace{4pt}';
    } catch { presenter.warn('Summary/subtitle generation failed — keeping the current header.'); }

    // ---- resolve role + paths --------------------------------------------
    const role = roleOverride || extractRoleFromJd(jd) || graph.domain || 'Software Engineer';
    const paths = outputPaths(root, { company, fullName: facts.identity?.name || 'Sandeep Singh', role });
    await mkdir(paths.dir, { recursive: true });
    await mkdir(join(root, 'build'), { recursive: true });

    // ---- render + guard, shrinking bullet budgets on overflow -------------
    const header = { summaryLatex, subtitleLatex };
    let shrink = 0;
    const spin2 = presenter.spinner('Rendering PDF & running guards…');
    let guards = await this.renderAndGuard(this.assemble(resumeTex, header, anchored, shrink), paths);
    if (guardsPass(guards)) spin2.succeed('PDF rendered — guards passed.');
    else spin2.warn(`Guard failed: ${describeGuardFailure(guards)} — shrinking.`);

    for (; !guardsPass(guards) && shrink < MAX_SHRINK_ATTEMPTS; ) {
      shrink++;
      const spinShrink = presenter.spinner(`Trimming bullets & re-rendering (shrink ${shrink}/${MAX_SHRINK_ATTEMPTS})…`);
      guards = await this.renderAndGuard(this.assemble(resumeTex, header, anchored, shrink), paths);
      if (guardsPass(guards)) spinShrink.succeed(`Guards passed after shrink ${shrink}.`);
      else spinShrink.warn(`Still failing: ${describeGuardFailure(guards)}.`);
    }
    const passed = guardsPass(guards);

    // ---- lockfile ---------------------------------------------------------
    const selected: LockedUnit[] = [];
    for (const spec of RESUME_ANCHORS) {
      for (const b of limitBullets(anchored.get(spec.anchor) ?? [], spec, shrink)) {
        selected.push({ id: b.unit.id, claim: b.unit.claim, score: Number(b.score.toFixed(4)), anchor: spec.anchor });
      }
    }
    const lock: BuildLock = {
      version: BUILD_LOCK_VERSION,
      company, role,
      jd_hash: graph.jd_hash,
      weights_hash: hashWeights(weights),
      template_hash: hashTemplate(resumeTex),
      requirement_graph: graph,
      selected,
      ats_score: score,
      coverage_score: Number(coverageScore.toFixed(4)),
      guards_pass: passed,
      createdAt: new Date().toISOString(),
    };
    await writeBuildLock(paths, lock);

    // ---- report -----------------------------------------------------------
    const report: TailorReportData = {
      cls, score, role,
      summaryText: `${selected.length} evidence units selected across ${RESUME_ANCHORS.length} entries (coverage ${lock.coverage_score}).`,
      subtitle: graph.domain,
      rationale: `Coverage-based build. Requirements: ${graph.must_have.map((r) => r.req).slice(0, 6).join('; ')}.`,
      guards: { pages: guards.pages, width: guards.width },
      paths, guardsPass: passed, provider: provider.id, model: provider.model,
    };
    await writeFile(paths.report, buildReportMarkdown(report));

    return {
      paths, role, score, coverageScore: lock.coverage_score,
      guardsPass: passed, lockPath: buildLockPath(paths), selectedCount: selected.length, report,
    };
  }

  // Select the best-covering units for one entry, then draft + groundedness-check
  // its bullets. Returns only grounded bullets, each with its backing unit + score.
  private async selectAndWrite(
    spec: AnchorSpec,
    groupUnits: EvidenceUnit[],
    requirements: Requirement[],
    unitVec: Map<string, number[]>,
    reqVectors: number[][],
    weights: Weights,
    atsKeywords: string[],
    provider: LlmProvider,
    now: Date,
  ): Promise<AnchoredBullet[]> {
    const vectors = groupUnits.map((u) => unitVec.get(u.id) ?? []);
    const relevance = requirements.length
      ? buildRelevanceMatrix({ units: groupUnits, unitVectors: vectors, requirements, requirementVectors: reqVectors, weights, now })
      : groupUnits.map(() => []) as unknown as number[][];

    const pinnedIds = new Set(groupUnits.filter((u) => u.tier === 'pinned').map((u) => u.id));
    const selection = requirements.length
      ? selectCoverage({ units: groupUnits, unitVectors: vectors, requirements, relevance, weights, budget: spec.maxBullets, pinnedIds })
      : { selected: groupUnits.slice(0, spec.maxBullets), selectedIds: [], coverage: [], score: 0, totalCost: 0, budget: spec.maxBullets };

    if (!selection.selected.length) return [];

    const scoreOf = (unit: EvidenceUnit): number => {
      const e = groupUnits.indexOf(unit);
      let m = 0;
      for (let r = 0; r < requirements.length; r++) if (relevance[r]?.[e] > m) m = relevance[r][e];
      return m;
    };

    const bullets = await writeBullets({ section: spec.label, units: selection.selected, atsKeywords, maxBullets: spec.maxBullets, provider });
    const violations = new Set(checkGroundedness(bullets, selection.selected).map((v) => v.bullet));
    const byId = new Map(selection.selected.map((u) => [u.id, u]));

    const out: AnchoredBullet[] = [];
    for (const b of bullets) {
      if (violations.has(b.text)) continue;
      const unit = byId.get(b.unit_id);
      if (!unit) continue;
      out.push({ bullet: b, unit, score: scoreOf(unit), anchor: spec.anchor });
    }
    return out;
  }

  // Assemble the tailored .tex: header blocks + each entry's bullets (trimmed to
  // the current shrink level). Empty groups keep their original bullets untouched.
  private assemble(
    resumeTex: string,
    header: { summaryLatex: string; subtitleLatex: string },
    anchored: Map<string, AnchoredBullet[]>,
    shrink: number,
  ): string {
    let out = resumeTex;
    out = replaceBlock(out, 'summary', header.summaryLatex);
    out = replaceBlock(out, 'subtitle', header.subtitleLatex);
    for (const spec of RESUME_ANCHORS) {
      const bullets = limitBullets(anchored.get(spec.anchor) ?? [], spec, shrink);
      if (!bullets.length) continue; // no evidence for this entry → leave hand-written bullets
      const rendered = bullets.map((b) => `    \\resumeItem{${boldify(b.bullet.text, [])}}`).join('\n\n');
      out = replaceBlock(out, spec.anchor, '\n' + rendered + '\n    ');
    }
    return out;
  }

  private async renderAndGuard(out: string, paths: OutputPaths): Promise<Guards> {
    const { root, latex, pdf } = this.deps;
    await writeFile(paths.tex, out);
    await writeFile(paths.buildTex, out);
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

// Bullets for an anchor at a given shrink level (each shrink drops one bullet,
// min 1 kept while any exist).
function limitBullets(bullets: AnchoredBullet[], spec: AnchorSpec, shrink: number): AnchoredBullet[] {
  const limit = Math.max(1, spec.maxBullets - shrink);
  return bullets.slice(0, limit);
}

// The current content between an anchor's markers (fallback header when the LLM
// summary/subtitle call fails).
function replaceMarker(tex: string, key: string): string {
  const re = new RegExp(`%%\\s*>>>TAILOR:${key}[^\\n]*\\n([\\s\\S]*?)\\n\\s*%%\\s*<<<TAILOR:${key}`);
  return tex.match(re)?.[1] ?? '';
}
