// GitHub profile writes — update the account bio, a repo description, or the
// profile README (the special <user>/<user> repo). Each write has a matching
// read so a caller can show the current value, confirm, then push. All writes
// REQUIRE a token; the bio needs `user` scope specifically.
import { ghFetch, scopeHint } from './api.js';

export interface GithubUser {
  login: string;
  bio: string;
}

export class GithubProfileService {
  constructor(private readonly token: string) {
    if (!token) throw new Error('GITHUB_TOKEN not set — profile updates need a token in .env.');
  }

  async getUser(): Promise<GithubUser> {
    const res = await ghFetch('/user', { token: this.token });
    if (!res.ok) throw new Error(`GitHub /user ${res.status}${scopeHint(res)}`);
    const u = await res.json() as { login: string; bio?: string };
    return { login: u.login, bio: u.bio || '' };
  }

  async setBio(bio: string): Promise<void> {
    const res = await ghFetch('/user', { token: this.token, method: 'PATCH', body: { bio } });
    if (!res.ok) throw new Error(`Could not update bio (GitHub ${res.status})${scopeHint(res)}`);
  }

  async getRepoDescription(owner: string, repo: string): Promise<string> {
    const res = await ghFetch(`/repos/${owner}/${repo}`, { token: this.token });
    if (!res.ok) throw new Error(`GitHub repo ${owner}/${repo} ${res.status}`);
    return ((await res.json()) as { description?: string }).description || '';
  }

  async setRepoDescription(owner: string, repo: string, description: string): Promise<void> {
    const res = await ghFetch(`/repos/${owner}/${repo}`, { token: this.token, method: 'PATCH', body: { description } });
    if (!res.ok) throw new Error(`Could not update ${owner}/${repo} description (GitHub ${res.status})${scopeHint(res)}`);
  }

  // The profile README lives at <owner>/<owner>/README.md. Returns null if absent.
  async getProfileReadme(owner: string): Promise<{ text: string; sha: string } | null> {
    const res = await ghFetch(`/repos/${owner}/${owner}/contents/README.md`, { token: this.token });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub README fetch ${res.status}`);
    const j = await res.json() as { content: string; sha: string; encoding: string };
    const text = Buffer.from(j.content, (j.encoding as BufferEncoding) || 'base64').toString('utf8');
    return { text, sha: j.sha };
  }

  async setProfileReadme(owner: string, text: string, sha: string | undefined, message: string): Promise<void> {
    const res = await ghFetch(`/repos/${owner}/${owner}/contents/README.md`, {
      token: this.token,
      method: 'PUT',
      body: { message, content: Buffer.from(text, 'utf8').toString('base64'), ...(sha ? { sha } : {}) },
    });
    if (!res.ok) throw new Error(`Could not update profile README (GitHub ${res.status})${scopeHint(res)}`);
  }
}
