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
  hashSources, writeLock, LINKEDIN_LIVE_DEPRECATED, type CheckScope,
} from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { cap } from './shared.js';
import { JD_INPUT_SHAPE, resolveJd } from './inputs.js';
import { describeTool } from './describe.js';

const rel = (root: string, p: string): string => relative(root, p).replace(/\\/g, '/');

// The same names the CLI's `resume check --<scope>` takes.
const CHECK_SCOPES = ['all', 'source', 'pdf', 'width'] as const;

// Undefined means "every guard" to checkResume; the PDF guard pulls width along,
// since an overfull line is a property of that render.
function checkScope(scope?: typeof CHECK_SCOPES[number]): CheckScope | undefined {
  if (!scope || scope === 'all') return undefined;
  return { source: scope === 'source', pdf: scope === 'pdf', width: scope === 'width' || scope === 'pdf' };
}

export function pipelineTools(deps: AgentDeps) {
  const service = (): TailorService => new TailorService({
    root: deps.root, latex: deps.latex, pdf: deps.pdf, presenter: deps.presenter,
  });

  const tailor_plan = createTool({
    id: 'tailor_plan',
    description: describeTool({
      does:
        'First half of tailoring: refresh stale sources, score the JD, and ask the model to rewrite the ' +
        'résumé — summary, subtitle and any experience or project bullet — from the VERIFIED fact base ' +
        'only. Returns the proposed copy, the current score and the score this rewrite is projected to ' +
        'reach, the detected role and the remaining gaps, and saves the plan for tailor_render. Renders ' +
        'nothing, so it needs no LaTeX toolchain.',
      cost: 'llm',
      use: 'the user has decided to apply somewhere. Show them the proposed copy before rendering it.',
      avoid: 'judging fit or answering "should I apply?" — score_jd does that for free.',
      needs: 'a company name and an LLM key. The user is asked before the run starts, because it costs credits.',
      then: 'tailor_render turns the plan into the PDF.',
    }),
    inputSchema: z.object({
      ...JD_INPUT_SHAPE,
      company: z.string().describe('Company name — the output is filed and named by it.'),
      role: z.string().optional().describe('Override the role title; omit to infer from the JD.'),
    }),
    execute: async ({ company, role, ...jdInput }) => {
      const jd = await resolveJd(deps.root, jdInput);
      const ok = await deps.confirm({
        tool: 'tailor_plan',
        action: 'Write new résumé copy for this job description',
        params: {
          company,
          role: role || '(read from the job description)',
          'job description': `${jd.trim().length} chars — ${jd.trim().slice(0, 90).replace(/\s+/g, ' ')}…`,
          cost: 'one model call',
        },
      });
      if (!ok) return { ran: false, reason: 'Cancelled — nothing was tailored.' };
      const refresher = new SourceRefresher({
        githubToken: deps.config.githubToken,
        linkedinCookie: deps.config.linkedinCookie,
        ttlHours: deps.config.scrapeTtlHours,
        llm: deps.llm,
      });
      const { plan, paths } = await service().plan({ jd, company, role: role || '' }, { llm: deps.llm, refresher });
      const blocked = deps.latex.availability();
      return {
        company: paths.slug,
        role: plan.role,
        score: { current: plan.score.before, projected: plan.score.after },
        matched: cap(plan.cls.matched),
        gaps: cap(plan.cls.missing),
        summary: plan.edit.summary,
        subtitle: plan.edit.subtitle.join(' | '),
        bullets: plan.edit.bullets,
        rationale: plan.edit.rationale,
        nextSteps: [
          'Show the user this copy — it is what will go on the PDF.',
          blocked
            ? `tailor_render cannot run yet: ${blocked === 'docker-daemon-down' ? 'the Docker daemon is down' : 'no LaTeX engine is installed'}.`
            : `tailor_render with company "${company}" compiles it and runs the guards.`,
        ],
      };
    },
  });

  const tailor_render = createTool({
    id: 'tailor_render',
    description: describeTool({
      does:
        'Second half of tailoring: apply the saved plan to the résumé document, compile the one-page ' +
        'PDF and run the page and width guards, re-asking the model for tighter copy when one fails. ' +
        'Returns the PDF path, the guard results, and any rewrite that was reverted because the fact ' +
        'base did not back it.',
      cost: 'llm',
      use: 'straight after tailor_plan, once the user has seen the copy.',
      avoid: 'a company that has no plan yet — run tailor_plan first.',
      needs: 'a LaTeX toolchain (Docker running, or latexmk). Tightening a failed guard costs another model call, so the user is asked first.',
      then: 'draft_application_email or outreach_message. The application records itself; no need to log it.',
    }),
    inputSchema: z.object({
      company: z.string().describe('Company whose plan to render, as passed to tailor_plan.'),
    }),
    execute: async ({ company }) => {
      const svc = service();
      const plan = await svc.loadPlan(company);
      const ok = await deps.confirm({
        tool: 'tailor_render',
        action: 'Compile this copy into a tailored PDF',
        params: {
          company: plan.company,
          role: plan.role,
          subtitle: plan.edit.subtitle.join(' | '),
          rewrites: `${plan.edit.bullets.length} bullet(s) plus the summary`,
          cost: 'compiles locally; up to two more model calls if a guard fails',
        },
        preview: plan.edit.summary,
      });
      if (!ok) return { ran: false, reason: 'Cancelled — nothing was rendered.' };
      const result = await svc.render(plan, { llm: deps.llm });
      const r = result.report;
      return {
        company: result.paths.slug,
        role: result.role,
        score: { current: r.score.before, tailored: r.score.after, projected: r.projectedAfter },
        gaps: cap(r.cls.missing),
        pdf: rel(deps.root, result.paths.pdf),
        guardsPass: result.guardsPass,
        pages: r.guards.pages,
        widthProblems: r.guards.width,
        summary: r.summary,
        subtitle: r.subtitle,
        rewritten: r.edited,
        reverted: r.reverted,
        nextSteps: result.guardsPass
          ? ['The PDF passed its guards. draft_application_email attaches it; outreach_message writes the shorter copy.']
          : [`NOT ship-ready: ${r.guards.pages} page(s), ${r.guards.width.length} overflowing line(s). Say so; do not send it.`],
      };
    },
  });

  const sync_profiles = createTool({
    id: 'sync_profiles',
    description: describeTool({
      does:
        'Refresh the scraped profile sources into profile/*.json when stale, then re-baseline the drift ' +
        'hashes so tailoring stops warning that the fact base may be behind.',
      cost: 'network',
      use: 'profile_status reports drift or stale sources, or the user just shipped something public.',
      avoid: 'the `linkedin` option — the live scrape is DEPRECATED and refuses to run. profile/linkedin.json is still read; it is refreshed from a PDF export or by hand.',
      needs: 'GITHUB_TOKEN for a complete GitHub read.',
      then: 'read_profile to see what changed before drafting from it.',
    }),
    inputSchema: z.object({
      force: z.boolean().optional().describe('Re-scrape even if sources are still fresh.'),
      linkedin: z.boolean().optional().describe('DEPRECATED — the live LinkedIn scrape no longer runs and this returns why.'),
    }),
    execute: async ({ force, linkedin }) => {
      if (linkedin) {
        return { sources: [], deprecated: true, reason: LINKEDIN_LIVE_DEPRECATED, nextSteps: ['Re-run without `linkedin` to refresh GitHub.'] };
      }
      const refresher = new SourceRefresher({
        githubToken: deps.config.githubToken,
        linkedinCookie: deps.config.linkedinCookie,
        ttlHours: deps.config.scrapeTtlHours,
        liveLinkedin: Boolean(linkedin),
        llm: deps.llm,
      });
      const results = await refresher.refreshAll(deps.root, {
        force: Boolean(force),
        log: (r) => deps.presenter.info(`${r.source}: ${r.status}`),
      });
      await writeLock(deps.root, await hashSources(deps.root));
      const failed = results.filter((r) => r.status === 'error');
      return {
        sources: results.map((r) => ({ source: r.source, status: r.status, error: r.error })),
        nextSteps: failed.length
          ? [`${failed.map((r) => r.source).join(', ')} did not refresh — the cached copy is still in use, so anything drafted now may be behind.`]
          : ['Sources are current. update_facts if the scrape shows something true that the fact base lacks.'],
      };
    },
  });

  const build_resume = createTool({
    id: 'build_resume',
    description: describeTool({
      does: 'Compile the canonical resume.tex to apps/web/assets/resume.pdf, exactly as CI does.',
      cost: 'local',
      use: 'after editing resume.tex, or when profile_status says the canonical PDF is missing or stale.',
      avoid: 'producing a per-company PDF — that is tailor_plan then tailor_render.',
      needs: 'a LaTeX toolchain: the Docker daemon running, or latexmk installed. The user is asked first, because it replaces the PDF the site serves.',
      then: 'check_resume — a build that compiles can still fail the guards.',
    }),
    inputSchema: z.object({}),
    execute: async () => {
      const reason = deps.latex.availability();
      if (reason) {
        throw new Error(reason === 'docker-daemon-down'
          ? 'Docker daemon is down — start Docker Desktop (or install latexmk).'
          : 'No LaTeX engine — install latexmk or Docker.');
      }
      const ok = await deps.confirm({
        tool: 'build_resume',
        action: 'Rebuild the canonical résumé PDF',
        params: {
          source: 'resume.tex',
          output: 'apps/web/assets/resume.pdf (overwritten — this is the PDF the site serves)',
        },
      });
      if (!ok) return { built: false, reason: 'Cancelled — nothing was built.' };
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
      return {
        built: true, engine: res.engine, pdf: rel(deps.root, dest),
        nextSteps: ['check_resume — compiling is not the same as passing the guards.'],
      };
    },
  });

  const check_resume = createTool({
    id: 'check_resume',
    description: describeTool({
      does:
        'Run the résumé guards: source structure, rendered-PDF structure (one page, required sections, ' +
        'contact email), and width (overfull lines). Scope "all" runs every guard and skips the two ' +
        'that need a build when no PDF exists yet.',
      cost: 'local',
      use: 'before treating the résumé as ship-ready, and after any edit to resume.tex.',
      needs: 'a built PDF for the pdf and width scopes — run build_resume first, or they are skipped.',
      then: 'if a guard fails the résumé is NOT ship-ready; say so rather than sending it.',
    }),
    inputSchema: z.object({
      scope: z.enum(CHECK_SCOPES).optional()
        .describe('Which guard to run; "pdf" runs width too, since overflow is a property of that render. Default "all".'),
    }),
    execute: async ({ scope }) => {
      const r = await checkResume({ root: deps.root, scope: checkScope(scope) });
      const skipped = r.pdf.skipped || r.width.skipped;
      return {
        pass: r.pass,
        source: r.source.ran ? r.source.problems : 'not run',
        pdf: r.pdf.skipped ? 'skipped (not built)' : r.pdf.ran ? r.pdf.problems : 'not run',
        width: r.width.skipped ? 'skipped (not built)' : r.width.ran ? r.width.problems : 'not run',
        nextSteps: r.pass
          ? skipped
            ? ['The guards that need a built PDF were skipped — run build_resume, then check again for a full answer.']
            : ['Every guard passed.']
          : ['Fix the problems above in resume.tex, rebuild, and check again. A failing résumé is not ship-ready.'],
      };
    },
  });

  return { tailor_plan, tailor_render, sync_profiles, build_resume, check_resume };
}
