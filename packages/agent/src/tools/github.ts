// update_github_profile — push a bio, a repo description, or the profile README
// to GitHub. Every push shows the current→new change and passes through the
// confirm gate; the model cannot push silently. Needs GITHUB_TOKEN (the bio needs
// `user` scope).
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { GithubProfileService, githubUsername } from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { loadFacts } from './shared.js';

export function githubTools(deps: AgentDeps) {
  const update_github_profile = createTool({
    id: 'update_github_profile',
    description:
      'Push an update to GitHub: the account bio, a repository description, or the profile README ' +
      '(the <user>/<user> repo). Draft the new copy first (grounded in the fact base), then call this ' +
      'to push it — a terminal confirmation showing the current→new change is REQUIRED, and you cannot ' +
      'bypass it. Needs GITHUB_TOKEN; the bio needs the token\'s `user` scope.',
    inputSchema: z.object({
      target: z.enum(['bio', 'repo_description', 'profile_readme']).describe('What to update.'),
      bio: z.string().optional().describe('New bio (for target=bio).'),
      repo: z.string().optional().describe('Repo name (for target=repo_description).'),
      description: z.string().optional().describe('New repo description (for target=repo_description).'),
      readme: z.string().optional().describe('Full new README markdown (for target=profile_readme).'),
    }),
    execute: async ({ target, bio, repo, description, readme }) => {
      if (!deps.config.githubToken) return { pushed: false, reason: 'GITHUB_TOKEN not set — add one to .env to push.' };
      const facts = await loadFacts(deps.root);
      const owner = githubUsername(facts.identity?.github || 'Sandy-1711');
      const svc = new GithubProfileService(deps.config.githubToken);

      if (target === 'bio') {
        if (!bio?.trim()) throw new Error('Provide the new bio text.');
        const cur = await svc.getUser();
        const ok = await deps.confirm(`Update GitHub bio?\n    from: "${cur.bio}"\n    to:   "${bio.trim()}"`);
        if (!ok) return { pushed: false, reason: 'Cancelled — bio unchanged.' };
        await svc.setBio(bio.trim());
        return { pushed: true, target, value: bio.trim() };
      }

      if (target === 'repo_description') {
        if (!repo?.trim() || !description?.trim()) throw new Error('Provide both repo and description.');
        const cur = await svc.getRepoDescription(owner, repo.trim());
        const ok = await deps.confirm(`Update ${owner}/${repo.trim()} description?\n    from: "${cur}"\n    to:   "${description.trim()}"`);
        if (!ok) return { pushed: false, reason: 'Cancelled — description unchanged.' };
        await svc.setRepoDescription(owner, repo.trim(), description.trim());
        return { pushed: true, target, repo: repo.trim(), value: description.trim() };
      }

      // profile_readme
      if (!readme?.trim()) throw new Error('Provide the full README markdown.');
      const cur = await svc.getProfileReadme(owner);
      const ok = await deps.confirm(`Replace ${owner}/${owner} profile README (${cur ? `${cur.text.length} chars now` : 'none yet'}) with ${readme.length} chars?`);
      if (!ok) return { pushed: false, reason: 'Cancelled — README unchanged.' };
      await svc.setProfileReadme(owner, readme, cur?.sha, 'chore: update profile README via résumé agent');
      return { pushed: true, target, chars: readme.length };
    },
  });

  return { update_github_profile };
}
