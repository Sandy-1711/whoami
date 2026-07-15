// profile_enhancer — compare the fact base to the live LinkedIn/GitHub scrape and
// produce paste-ready copy + a stale/missing list. Wraps EnhanceService; writes
// linkedin-updates.md (gitignored). Read-only w.r.t. the live profiles — the user
// pastes the suggestions in by hand.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { EnhanceService } from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { cap } from './shared.js';

export function enhanceTools(deps: AgentDeps) {
  const profile_enhancer = createTool({
    id: 'profile_enhancer',
    description:
      'Generate paste-ready public-profile copy FROM the evidence store and report drift vs the live ' +
      'LinkedIn + GitHub scrape: a LinkedIn headline, About, skills to add, a GitHub bio, a GitHub ' +
      'profile-README Highlights section, plus a deterministic stale/missing list (evidenced skills the ' +
      'live profiles omit, proof not surfaced, repos lacking descriptions). Writes linkedin-updates.md. ' +
      'Grounded in evidence.json + facts.json — LinkedIn stays manual-paste; the README section can be ' +
      'pushed with update_github_profile. Consider sync_profiles first if the scrape is stale, and ' +
      'ingest_evidence if the store is empty.',
    inputSchema: z.object({
      target: z.string().optional().describe('Optional positioning focus, e.g. "remote agent-infrastructure roles".'),
    }),
    execute: async ({ target }) => {
      const llm = deps.registry.resolve(deps.config);
      const service = new EnhanceService({ root: deps.root, presenter: deps.presenter });
      const r = await service.suggest({ target: target || '' }, { provider: llm });
      return {
        evidenceUnits: r.evidenceUnits,
        linkedinHeadline: r.linkedin.headline,
        linkedinAbout: r.linkedin.about,
        linkedinSkillsToAdd: cap(r.linkedin.skillsToAdd),
        githubBio: r.github.bio,
        githubReadme: r.github.readme,
        driftCount: r.drift.length,
        staleOrMissing: cap(r.staleOrMissing),
        file: r.relPath,
      };
    },
  });

  return { profile_enhancer };
}
