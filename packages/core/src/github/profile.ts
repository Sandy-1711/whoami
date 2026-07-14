// GitHub profile writes — update the account bio, a repo description, or the
// profile README (the special <user>/<user> repo). Read + write are separate so
// a caller can show the current value, confirm, then push. Uses the REST API
// directly with a token (same approach as the scraper). All writes REQUIRE a
// token; the bio needs `user` scope specifically.
const API = 'https://api.github.com';

function headers(token: string, write = false): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'whoami-resume-agent',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
  };
  if (write) h['Content-Type'] = 'application/json';
  return h;
}

async function ghFetch(path: string, token: string, init?: { method?: string; body?: unknown }): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: init?.method || 'GET',
    headers: headers(token, Boolean(init?.body)),
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
}

function scopeHint(res: Response): string {
  return res.status === 403 || res.status === 404
    ? ' — your token may lack the required scope. For the bio, refresh with: gh auth refresh -h github.com -s user'
    : '';
}

export interface GithubUser {
  login: string;
  bio: string;
}

export class GithubProfileService {
  constructor(private readonly token: string) {
    if (!token) throw new Error('GITHUB_TOKEN not set — profile updates need a token in .env.');
  }

  async getUser(): Promise<GithubUser> {
    const res = await ghFetch('/user', this.token);
    if (!res.ok) throw new Error(`GitHub /user ${res.status}${scopeHint(res)}`);
    const u = await res.json() as { login: string; bio?: string };
    return { login: u.login, bio: u.bio || '' };
  }

  async setBio(bio: string): Promise<void> {
    const res = await ghFetch('/user', this.token, { method: 'PATCH', body: { bio } });
    if (!res.ok) throw new Error(`Could not update bio (GitHub ${res.status})${scopeHint(res)}`);
  }

  async getRepoDescription(owner: string, repo: string): Promise<string> {
    const res = await ghFetch(`/repos/${owner}/${repo}`, this.token);
    if (!res.ok) throw new Error(`GitHub repo ${owner}/${repo} ${res.status}`);
    return ((await res.json()) as { description?: string }).description || '';
  }

  async setRepoDescription(owner: string, repo: string, description: string): Promise<void> {
    const res = await ghFetch(`/repos/${owner}/${repo}`, this.token, { method: 'PATCH', body: { description } });
    if (!res.ok) throw new Error(`Could not update ${owner}/${repo} description (GitHub ${res.status})${scopeHint(res)}`);
  }

  // The profile README lives at <owner>/<owner>/README.md. Returns null if absent.
  async getProfileReadme(owner: string): Promise<{ text: string; sha: string } | null> {
    const res = await ghFetch(`/repos/${owner}/${owner}/contents/README.md`, this.token);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub README fetch ${res.status}`);
    const j = await res.json() as { content: string; sha: string; encoding: string };
    const text = Buffer.from(j.content, (j.encoding as BufferEncoding) || 'base64').toString('utf8');
    return { text, sha: j.sha };
  }

  async setProfileReadme(owner: string, text: string, sha: string | undefined, message: string): Promise<void> {
    const res = await ghFetch(`/repos/${owner}/${owner}/contents/README.md`, this.token, {
      method: 'PUT',
      body: { message, content: Buffer.from(text, 'utf8').toString('base64'), ...(sha ? { sha } : {}) },
    });
    if (!res.ok) throw new Error(`Could not update profile README (GitHub ${res.status})${scopeHint(res)}`);
  }
}
