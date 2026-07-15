// Pipeline tools — the ones that do real work: tailor a résumé to a JD, refresh
// scraped sources, build the canonical PDF, and run the guards. Each wraps the
// same core service the CLI command uses, and returns a compact structured
// result (never a full report) to stay within the model's context budget.
import { relative } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  SourceRefresher, TailorService, checkResume,
  hashSources, writeLock, type CheckScope,
} from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { cap } from './shared.js';

const rel = (root: string, p: string): string => relative(root, p).replace(/\\/g, '/');

export function pipelineTools(deps: AgentDeps) {
  const tailor_resume = createTool({
    id: 'tailor_resume',
    description:
      'Tailor the résumé to a job description and render a one-page ATS-optimized PDF. Refreshes ' +
      'stale sources, rewrites the summary/subtitle from the VERIFIED fact base only (never invents ' +
      'facts), compiles, and runs the page/width guards (auto-tightening on overflow). Requires the ' +
      'company name (files the output) and an LLM key. Returns the before/after ATS score, detected ' +
      'role, remaining gaps, and the PDF path. Needs a working LaTeX toolchain (Docker/latexmk).',
    inputSchema: z.object({
      jd: z.string().describe('The full job description text.'),
      company: z.string().describe('Company name — the output is filed and named by it.'),
      role: z.string().optional().describe('Override the role title; omit to infer from the JD.'),
    }),
    execute: async ({ jd, company, role }) => {
      const llm = deps.registry.resolve(deps.config);
      const refresher = new SourceRefresher({
        githubToken: deps.config.githubToken,
        linkedinCookie: deps.config.linkedinCookie,
        ttlHours: deps.config.scrapeTtlHours,
        llm,
      });
      const service = new TailorService({
        root: deps.root, latex: deps.latex, pdf: deps.pdf, presenter: deps.presenter,
      });
      const result = await service.run({ jd, company, role: role || '' }, { provider: llm, refresher });
      const r = result.report;
      return {
        company: result.paths.slug,
        role: result.role,
        score: { current: r.score.before, tailored: r.score.after },
        matched: cap(r.cls.matched),
        gaps: cap(r.cls.missing),
        pdf: rel(deps.root, result.paths.pdf),
        guardsPass: result.guardsPass,
        pages: r.guards.pages,
        widthProblems: r.guards.width,
        summary: r.summaryText,
        subtitle: r.subtitle,
      };
    },
  });

  const sync_profiles = createTool({
    id: 'sync_profiles',
    description:
      'Refresh the scraped profile sources into profile/*.json when stale, then re-baseline the drift ' +
      'hashes so tailoring stops warning about stale facts. Refreshes GitHub by default; the LinkedIn ' +
      'scrape is automated against their ToS (account-ban risk) so it is OPT-IN — set `linkedin: true` ' +
      'only when the user explicitly asks to scrape LinkedIn. `force` ignores the freshness TTL.',
    inputSchema: z.object({
      force: z.boolean().optional().describe('Re-scrape even if sources are still fresh.'),
      linkedin: z.boolean().optional().describe('Opt in to the LinkedIn scrape (default off — ToS/ban risk). Only when the user explicitly asks.'),
    }),
    execute: async ({ force, linkedin }) => {
      let llm;
      try { llm = deps.registry.resolve(deps.config); } catch { llm = undefined; }
      const refresher = new SourceRefresher({
        githubToken: deps.config.githubToken,
        linkedinCookie: deps.config.linkedinCookie,
        ttlHours: deps.config.scrapeTtlHours,
        liveLinkedin: Boolean(linkedin),
        llm,
      });
      const results = await refresher.refreshAll(deps.root, {
        force: Boolean(force),
        log: (r) => deps.presenter.info(`${r.source}: ${r.status}`),
      });
      await writeLock(deps.root, await hashSources(deps.root));
      return {
        sources: results.map((r) => ({ source: r.source, status: r.status, error: r.error })),
      };
    },
  });

  const build_resume = createTool({
    id: 'build_resume',
    description:
      'Compile the canonical resume.tex → apps/web/assets/resume.pdf, mirroring CI. Use after editing ' +
      'the résumé source, or when status shows the canonical PDF is missing/stale. Needs a LaTeX ' +
      'toolchain (Docker daemon running, or latexmk).',
    inputSchema: z.object({}),
    execute: async () => {
      const reason = deps.latex.availability();
      if (reason) {
        throw new Error(reason === 'docker-daemon-down'
          ? 'Docker daemon is down — start Docker Desktop (or install latexmk).'
          : 'No LaTeX engine — install latexmk or Docker.');
      }
      const spin = deps.presenter.spinner('Compiling resume.tex …');
      const res = deps.latex.compile(deps.root, 'resume.tex', { outDir: 'build', capture: true });
      const built = join(deps.root, 'build', 'resume.pdf');
      if (!existsSync(built)) {
        spin.fail('Build failed — resume.pdf was not produced.');
        throw new Error('Compilation error — check the build log.');
      }
      const dest = join(deps.root, 'apps', 'web', 'assets', 'resume.pdf');
      await mkdir(join(deps.root, 'apps', 'web', 'assets'), { recursive: true });
      await copyFile(built, dest);
      spin.succeed('Built resume.pdf → apps/web/assets/resume.pdf');
      return { built: true, engine: res.engine, pdf: rel(deps.root, dest) };
    },
  });

  const check_resume = createTool({
    id: 'check_resume',
    description:
      'Run the résumé guards: source structure, rendered-PDF structure (one page, required sections, ' +
      'contact email), and width (overfull lines). Omit scope to run all (PDF/width skipped if not ' +
      'built). Use before treating the résumé as ship-ready.',
    inputSchema: z.object({
      source: z.boolean().optional().describe('Run the source-structure guard.'),
      pdf: z.boolean().optional().describe('Run the PDF-structure guard (also runs width).'),
      width: z.boolean().optional().describe('Run the width guard.'),
    }),
    execute: async ({ source, pdf, width }) => {
      const anyFlag = source || pdf || width;
      const scope: CheckScope | undefined = anyFlag ? { source, pdf, width: width || pdf } : undefined;
      const r = await checkResume({ root: deps.root, scope });
      return {
        pass: r.pass,
        source: r.source.ran ? r.source.problems : 'not run',
        pdf: r.pdf.skipped ? 'skipped (not built)' : r.pdf.ran ? r.pdf.problems : 'not run',
        width: r.width.skipped ? 'skipped (not built)' : r.width.ran ? r.width.problems : 'not run',
      };
    },
  });

  return { tailor_resume, sync_profiles, build_resume, check_resume };
}
