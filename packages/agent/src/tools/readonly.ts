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
import { describeTool } from './describe.js';

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
    description: describeTool({
      does:
        'Score how well the current résumé matches a job description, by keyword matching — no model ' +
        'is involved, so the number is the same every time. Returns the ATS score before and after ' +
        'tailoring, and three keyword buckets: matched (already on the résumé), addable (TRUE facts ' +
        'the fact base has but the résumé does not surface), and missing (the JD wants them and the ' +
        'fact base cannot back them — these may NEVER be claimed).',
      cost: 'free',
      use: 'judging fit, and always before committing to a paid tailor run.',
      avoid: 'producing a tailored PDF — that is tailor_plan then tailor_render.',
      then: 'tailor_resume if the fit is worth it; otherwise report the gaps and stop.',
    }),
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
        nextSteps: [
          cls.missing.length
            ? `${cls.missing.length} JD keyword(s) are not in the fact base — say so plainly; never claim them.`
            : 'Nothing the JD asks for is missing from the fact base.',
          'tailor_plan drafts the copy for this JD; tailor_render then compiles it.',
        ],
      };
    },
  });

  const profile_status = createTool({
    id: 'profile_status',
    description: describeTool({
      does:
        'Report the state of the toolkit itself: which LLM keys are set and which is active, whether ' +
        'a LaTeX toolchain can render (and what is blocking it), how fresh the scraped sources are ' +
        'and whether they have drifted, whether the canonical PDF is built, and the most recent ' +
        'tailored outputs.',
      cost: 'free',
      use: 'answering "what is set up?", and before anything that needs Docker, a key, or fresh sources.',
      avoid: 'reading the candidate\'s facts or evidence — that is read_profile.',
      then: 'sync_profiles if sources drifted; build_resume if the canonical PDF is missing.',
    }),
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
    description: describeTool({
      does:
        'Read everything known about the candidate: the verified fact base (profile/facts.json), which ' +
        'is the ONLY source of allowed claims, together with a ranked digest of his public evidence — ' +
        'top GitHub repos, merged external PRs with titles, LinkedIn roles. The facts say what may be ' +
        'asserted; the evidence says which of them to lead with and lets you cite real repos and PRs. ' +
        'Scope to one section for a targeted lookup.',
      cost: 'free',
      use: 'once, before drafting or advising anything about the candidate. If a claim is not in here, it is not true for our purposes.',
      avoid: "reading a company's GitHub — that is read_github. Toolchain and freshness are profile_status.",
    }),
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
    description: describeTool({
      does: 'List the résumé PDFs and drafts already generated under tailored/, newest first, optionally filtered by company.',
      cost: 'free',
      use: 'finding an existing tailored PDF to attach, or checking what has already been produced for a company.',
      avoid: 'asking what was DONE for a company and when — that history is list_applications with activity.',
    }),
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
