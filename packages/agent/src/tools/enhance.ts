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
      'Compare the verified fact base to the live LinkedIn + GitHub scrape and suggest paste-ready ' +
      'improvements: a LinkedIn headline, About, skills to add, a GitHub bio, and a list of what looks ' +
      'stale or missing on the live profiles. Writes linkedin-updates.md. Grounded in facts.json — ' +
      'suggestions only, the user updates LinkedIn/GitHub by hand. Consider sync_profiles first if the ' +
      'scrape is stale.',
    inputSchema: z.object({
      target: z.string().optional().describe('Optional positioning focus, e.g. "remote agent-infrastructure roles".'),
    }),
    execute: async ({ target }) => {
      const llm = deps.registry.resolve(deps.config);
      const service = new EnhanceService({ root: deps.root, presenter: deps.presenter });
      const r = await service.suggest({ target: target || '' }, { provider: llm });
      return {
        linkedinHeadline: r.linkedin.headline,
        linkedinAbout: r.linkedin.about,
        linkedinSkillsToAdd: cap(r.linkedin.skillsToAdd),
        githubBio: r.github.bio,
        staleOrMissing: cap(r.staleOrMissing),
        file: r.relPath,
      };
    },
  });

  return { profile_enhancer };
}
