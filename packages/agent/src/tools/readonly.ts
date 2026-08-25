// Read-only tools — no writes, no network beyond what the deterministic scorer
// already does (none). These are the agent's senses: score a JD against the
// résumé, report studio status, read the fact base, and list tailored outputs.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  extractJdKeywords, classify, scoreResume, collectStatus, listTailoredOutputs,
  loadProfileDigest, renderProfileDigest,
} from '@resume/core';
import { defaultProviderId, listProviders } from '@resume/llm';
import type { AgentDeps } from '../deps.js';
import { loadFacts, loadResumeText, cap } from './shared.js';
import { JD_INPUT_SHAPE, resolveJd } from './inputs.js';

const FACT_SECTIONS = [
  'identity', 'title_variants', 'seniority', 'allowed_keywords',
  'skills', 'experience', 'projects', 'headline_metrics',
] as const;

// The fact base's own sections plus the ranked public evidence, which is not a
// section of facts.json but is read for the same reason and in the same breath.
const PROFILE_SECTIONS = [...FACT_SECTIONS, 'evidence'] as const;

export function readOnlyTools(deps: AgentDeps) {
  const score_jd = createTool({
    id: 'score_jd',
    description:
      'Deterministically score how well the current résumé matches a job description (JD). ' +
      'Fast — no LLM, no PDF. Returns the ATS score before/after tailoring and three keyword ' +
      'buckets: matched (already in the résumé), addable (TRUE facts to surface), and missing ' +
      '(the JD wants them but they are NOT in the fact base — never claim these). Use this to ' +
      'advise on fit before committing to a full tailor run.',
    inputSchema: z.object(JD_INPUT_SHAPE),
    execute: async (input) => {
      const jd = await resolveJd(deps.root, input);
      const [facts, resumeText] = [await loadFacts(deps.root), await loadResumeText(deps.root)];
      const cls = classify(extractJdKeywords(jd), resumeText, facts);
      const score = scoreResume(cls);
      return {
        score: { current: score.before, tailored: score.after, max: score.total },
        matched: cap(cls.matched),
        addable: cap(cls.addable),
        missing: cap(cls.missing),
      };
    },
  });

  const profile_status = createTool({
    id: 'profile_status',
    description:
      'Report the résumé studio status: which LLM keys are set and active, whether the LaTeX ' +
      'toolchain can render, scraped-source freshness and drift, whether the canonical PDF is ' +
      'built, and the most recent tailored outputs. Use to answer "what is set up?" and to ' +
      'decide whether a sync or build is needed first.',
    inputSchema: z.object({}),
    execute: async () => {
      const report = await collectStatus({
        root: deps.root,
        config: deps.config,
        providers: listProviders(),
        activeProviderId: defaultProviderId(deps.config.llm),
        renderReason: deps.latex.availability(),
        playwright: deps.playwright,
      });
      return {
        activeProvider: report.env.activeProvider,
        keysSet: report.env.providers.filter((p) => p.keySet).map((p) => p.id),
        canRender: report.toolchain.canRender,
        renderBlocker: report.toolchain.reason,
        github: report.sources.github,
        linkedin: report.sources.linkedin,
        drift: report.sources.drift,
        canonicalBuilt: report.canonical.built,
        tailoredCount: report.tailored.length,
        recentTailored: report.tailored.slice(0, 8).map((t) => t.relPath),
      };
    },
  });

  const read_profile = createTool({
    id: 'read_profile',
    description:
      'Read everything known about the candidate: the verified fact base (profile/facts.json) — ' +
      'the ONLY source of allowed claims — together with a ranked digest of his public evidence ' +
      '(top GitHub repos, merged external PRs with titles, LinkedIn roles). Call this once before ' +
      'drafting anything: the facts say what may be asserted, the evidence says which of those ' +
      'facts to lead with and lets you cite real repos and PRs. Scope to one section for a ' +
      'targeted lookup. If something is not in here, it must not be claimed.',
    inputSchema: z.object({
      section: z.enum(PROFILE_SECTIONS).optional()
        .describe("One section for a narrow lookup ('identity', 'skills', …, or 'evidence' for the digest alone); omit for everything."),
    }),
    execute: async ({ section }) => {
      if (section === 'evidence') return { evidence: await evidenceText(deps.root) };
      const facts = await loadFacts(deps.root);
      if (section) return { section, value: (facts as Record<string, unknown>)[section] ?? null };
      return { facts, evidence: await evidenceText(deps.root) };
    },
  });

  const list_outputs = createTool({
    id: 'list_outputs',
    description:
      'List tailored résumé PDFs and drafts already generated on disk (under tailored/), newest ' +
      'first. Optionally filter by company. Use to find an existing tailored PDF to attach to an ' +
      'email, or to check what has already been produced for a company.',
    inputSchema: z.object({
      company: z.string().optional().describe('Case-insensitive substring to filter the company folder by.'),
    }),
    execute: async ({ company }) => {
      let outputs = await listTailoredOutputs(deps.root);
      if (company?.trim()) {
        const needle = company.trim().toLowerCase();
        outputs = outputs.filter((o) => o.relPath.toLowerCase().includes(needle));
      }
      return { count: outputs.length, outputs: cap(outputs.map((o) => ({ path: o.relPath, modified: o.mtime })), 30) };
    },
  });

  return { score_jd, profile_status, read_profile, list_outputs };
}

// Curation pins first; forks, archived, and banned repos already excluded.
async function evidenceText(root: string): Promise<string> {
  const text = renderProfileDigest(await loadProfileDigest(root));
  return text || '(no scrape data — run sync_profiles first)';
}
