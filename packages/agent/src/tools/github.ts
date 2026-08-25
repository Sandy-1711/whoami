// GitHub, read and write. read_github looks at any account — the point being the
// company you are writing to, not only the candidate, since a cold email that
// names what a team actually builds beats one that does not. update_github_profile
// pushes to the candidate's own profile through the confirm gate.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { GithubProfileService, GithubReader, githubUsername } from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { loadFacts, cap } from './shared.js';
import { describeTool, CONFIRM_ARG } from './describe.js';

export function githubTools(deps: AgentDeps) {
  const read_github = createTool({
    id: 'read_github',
    description: describeTool({
      does:
        "Read anything public on GitHub. `repos` lists an account's repositories by most recent " +
        "activity, `repo` reads one, `readme` returns a repository's README (the best single source " +
        'on what a project actually does), `user` reads an account, `search` finds repositories.',
      cost: 'network',
      use: 'researching the COMPANY before writing to them, so the copy names what they really build.',
      avoid: "the candidate's own shipped work — read_profile already carries that, ranked and curated.",
      needs: 'nothing; GITHUB_TOKEN only raises the rate limit.',
      then: 'outreach_message or draft_application_email, now able to reference something real.',
    }),
    inputSchema: z.object({
      target: z.enum(['repos', 'repo', 'readme', 'user', 'search']).describe('What to read.'),
      owner: z.string().optional().describe('GitHub user or org (for repos/repo/readme/user). Defaults to the candidate.'),
      repo: z.string().optional().describe('Repository name (for repo/readme).'),
      query: z.string().optional().describe('Search query (for search), e.g. "agent orchestration language:typescript".'),
      limit: z.number().optional().describe('How many repositories to return (default 10).'),
    }),
    execute: async ({ target, owner, repo, query, limit }) => {
      const reader = new GithubReader(deps.config.githubToken);
      const account = owner?.trim() || githubUsername((await loadFacts(deps.root)).identity?.github || 'Sandy-1711');

      if (target === 'search') {
        if (!query?.trim()) throw new Error('Searching needs a `query`.');
        return { query, repos: cap(await reader.searchRepos(query.trim(), limit ?? 10), 25) };
      }
      if (target === 'user') return reader.user(account);
      if (target === 'repos') return { owner: account, repos: cap(await reader.repos(account, limit ?? 10), 50) };

      if (!repo?.trim()) throw new Error(`Reading a ${target} needs a \`repo\` name.`);
      if (target === 'repo') return reader.repo(account, repo.trim());
      const readme = await reader.readme(account, repo.trim());
      return { repo: `${account}/${repo.trim()}`, readme: readme ?? '(no README in this repository)' };
    },
  });

  const update_github_profile = createTool({
    id: 'update_github_profile',
    description: describeTool({
      does:
        "Push an update to the candidate's own GitHub: the account bio, a repository description, or " +
        'the profile README (the <user>/<user> repo).',
      cost: 'outward',
      use: 'the user has seen the new copy and asked for it to go live.',
      avoid: 'reading anything — that is read_github. And never push copy the user has not read.',
      needs: 'GITHUB_TOKEN (the bio needs its `user` scope), `confirm: true`, and a confirmation showing the current→new change that you cannot bypass.',
    }),
    inputSchema: z.object({
      target: z.enum(['bio', 'repo_description', 'profile_readme']).describe('What to update.'),
      confirm: z.boolean().describe(CONFIRM_ARG),
      bio: z.string().optional().describe('New bio (for target=bio).'),
      repo: z.string().optional().describe('Repo name (for target=repo_description).'),
      description: z.string().optional().describe('New repo description (for target=repo_description).'),
      readme: z.string().optional().describe('Full new README markdown (for target=profile_readme).'),
    }),
    execute: async ({ target, confirm, bio, repo, description, readme }) => {
      if (!confirm) {
        return {
          pushed: false,
          reason: 'Not pushed — `confirm` was not true.',
          nextSteps: ['Show the user the exact copy you would publish, then call again with confirm: true only if they approve it.'],
        };
      }
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

  return { read_github, update_github_profile };
}
