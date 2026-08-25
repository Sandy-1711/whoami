// Reading GitHub — any account, not only the candidate's. The profile digest
// already answers "what has he shipped"; this answers "what does the company
// actually build", which is what makes outreach concrete instead of generic.
import { ghFetch, ghError } from './api.js';

// A README is prose meant for humans and routinely runs to tens of KB; this is
// enough to know what a project is without swallowing a prompt budget.
const README_CAP = 6000;

export interface GithubRepoSummary {
  fullName: string;
  description: string;
  url: string;
  stars: number;
  language: string;
  topics: string[];
  pushedAt: string;
  archived: boolean;
  fork: boolean;
}

export interface GithubUserSummary {
  login: string;
  name: string;
  bio: string;
  company: string;
  blog: string;
  publicRepos: number;
  followers: number;
  url: string;
}

interface RawRepo {
  full_name: string; description?: string; html_url: string; stargazers_count?: number;
  language?: string; topics?: string[]; pushed_at?: string; archived?: boolean; fork?: boolean;
}

export class GithubReader {
  // Unauthenticated reads work; a token only raises the rate limit.
  constructor(private readonly token?: string) {}

  async user(login: string): Promise<GithubUserSummary> {
    const res = await ghFetch(`/users/${encodeURIComponent(login)}`, { token: this.token });
    if (!res.ok) throw ghError(res, `reading user ${login}`);
    const u = await res.json() as {
      login: string; name?: string; bio?: string; company?: string; blog?: string;
      public_repos?: number; followers?: number; html_url: string;
    };
    return {
      login: u.login,
      name: u.name || '',
      bio: u.bio || '',
      company: u.company || '',
      blog: u.blog || '',
      publicRepos: u.public_repos ?? 0,
      followers: u.followers ?? 0,
      url: u.html_url,
    };
  }

  async repo(owner: string, name: string): Promise<GithubRepoSummary> {
    const res = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, { token: this.token });
    if (!res.ok) throw ghError(res, `reading ${owner}/${name}`);
    return summarize(await res.json() as RawRepo);
  }

  // Newest activity first, which is what says where a team is actually working.
  async repos(owner: string, limit = 10): Promise<GithubRepoSummary[]> {
    const res = await ghFetch(
      `/users/${encodeURIComponent(owner)}/repos?sort=pushed&per_page=${Math.min(Math.max(limit, 1), 50)}`,
      { token: this.token },
    );
    if (!res.ok) throw ghError(res, `listing repos for ${owner}`);
    return (await res.json() as RawRepo[]).map(summarize);
  }

  async searchRepos(query: string, limit = 10): Promise<GithubRepoSummary[]> {
    const res = await ghFetch(
      `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=${Math.min(Math.max(limit, 1), 25)}`,
      { token: this.token },
    );
    if (!res.ok) throw ghError(res, `searching repositories for "${query}"`);
    return ((await res.json() as { items?: RawRepo[] }).items ?? []).map(summarize);
  }

  // Null rather than throwing when a repo simply has no README — an absence the
  // caller usually wants to report, not fail on.
  async readme(owner: string, name: string): Promise<string | null> {
    const res = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/readme`, { token: this.token });
    if (res.status === 404) return null;
    if (!res.ok) throw ghError(res, `reading ${owner}/${name} README`);
    const j = await res.json() as { content?: string; encoding?: string };
    if (!j.content) return null;
    const text = Buffer.from(j.content, (j.encoding as BufferEncoding) || 'base64').toString('utf8');
    return text.length > README_CAP ? text.slice(0, README_CAP) + '\n…(truncated)' : text;
  }
}

function summarize(r: RawRepo): GithubRepoSummary {
  return {
    fullName: r.full_name,
    description: r.description || '',
    url: r.html_url,
    stars: r.stargazers_count ?? 0,
    language: r.language || '',
    topics: r.topics ?? [],
    pushedAt: r.pushed_at || '',
    archived: Boolean(r.archived),
    fork: Boolean(r.fork),
  };
}
