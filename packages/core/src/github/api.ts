// The GitHub REST seam shared by the reader and the profile writer. A token is
// optional for reads (60 requests/hour without one, 5000 with) and required for
// every write.
const API = 'https://api.github.com';
const TIMEOUT_MS = 15_000;

export interface GhRequest {
  method?: string;
  body?: unknown;
  token?: string;
}

export async function ghFetch(path: string, { method, body, token }: GhRequest = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'whoami-resume-agent',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  return fetch(`${API}${path}`, {
    method: method || 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

// 403 on this API is nearly always rate limiting or a missing scope, and the two
// are worth telling apart before anyone goes looking for a bug.
export function ghError(res: Response, what: string): Error {
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset') || 0);
    const mins = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60_000)) : null;
    return new Error(`GitHub rate limit reached${mins ? ` — resets in ~${mins} min` : ''}. Set GITHUB_TOKEN in .env to raise it.`);
  }
  return new Error(`GitHub ${what} failed (${res.status} ${res.statusText})${scopeHint(res)}`);
}

export function scopeHint(res: Response): string {
  return res.status === 403 || res.status === 404
    ? ' — your token may lack the required scope. For the bio, refresh with: gh auth refresh -h github.com -s user'
    : '';
}
