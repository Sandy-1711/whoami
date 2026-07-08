// GitHub scraper: pull the user's public repos and their pull-request
// contributions to other repos, straight from the REST API. No auth needed for
// public data, but a GITHUB_TOKEN in .env lifts the rate limit and is used when
// present. The result is written to profile/github.json (an editable source).
const API = 'https://api.github.com';

function headers(token) {
  const h = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'whoami-resume-scraper',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function gh(path, token) {
  const res = await fetch(`${API}${path}`, { headers: headers(token) });
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
    const mins = Math.max(1, Math.ceil((reset - Date.now()) / 60000));
    throw new Error(`GitHub rate limit hit — resets in ~${mins} min. Add GITHUB_TOKEN to .env to raise it.`);
  }
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

// Extract "Sandy-1711" from a username, a URL, or a plain handle.
export function githubUsername(idOrUrl) {
  const s = String(idOrUrl || '').trim();
  const m = s.match(/github\.com\/([^/?#]+)/i);
  return (m ? m[1] : s).replace(/^@/, '');
}

// The user's own public, non-fork repositories, richest first.
async function fetchRepos(user, token) {
  const raw = await gh(`/users/${user}/repos?per_page=100&type=owner&sort=pushed`, token);
  return raw
    .filter((r) => !r.fork)
    .map((r) => ({
      name: r.name,
      description: r.description || '',
      url: r.html_url,
      homepage: r.homepage || '',
      stars: r.stargazers_count,
      language: r.language || '',
      topics: r.topics || [],
      archived: !!r.archived,
      pushedAt: r.pushed_at,
    }))
    .sort((a, b) => b.stars - a.stars || new Date(b.pushedAt) - new Date(a.pushedAt));
}

// Pull requests the user has authored anywhere, grouped by target repo with
// merged/open/closed tallies. Search results already carry pull_request.merged_at,
// so no per-PR fetch is needed to know what merged.
async function fetchContributions(user, token) {
  const byRepo = new Map();
  for (let page = 1; page <= 3; page++) {
    const q = encodeURIComponent(`type:pr author:${user}`);
    const data = await gh(`/search/issues?q=${q}&per_page=100&page=${page}&sort=updated`, token);
    const items = data.items || [];
    for (const it of items) {
      const repo = it.repository_url.replace(`${API}/repos/`, '');
      if (repo.toLowerCase().startsWith(`${user.toLowerCase()}/`)) continue; // own repos already covered
      const merged = !!it.pull_request?.merged_at;
      const g = byRepo.get(repo) || { repo, url: `https://github.com/${repo}`, merged: 0, open: 0, closedUnmerged: 0, samplePRs: [] };
      if (merged) g.merged++;
      else if (it.state === 'open') g.open++;
      else g.closedUnmerged++;
      if (g.samplePRs.length < 6) {
        g.samplePRs.push({ number: it.number, title: it.title, state: merged ? 'merged' : it.state, url: it.html_url });
      }
      byRepo.set(repo, g);
    }
    if (items.length < 100) break;
  }

  const groups = [...byRepo.values()].sort((a, b) => b.merged - a.merged || b.open - a.open);

  // Enrich the busiest external repos with their star counts (nice for the
  // report). Capped + fail-soft so a hiccup never sinks the whole scrape.
  for (const g of groups.slice(0, 8)) {
    try {
      const r = await gh(`/repos/${g.repo}`, token);
      g.stars = r.stargazers_count;
    } catch { /* leave stars undefined */ }
  }
  return groups;
}

export async function scrapeGithub({ username, token } = {}) {
  const user = githubUsername(username);
  if (!user) throw new Error('No GitHub username to scrape.');

  const [repos, contributions] = await Promise.all([
    fetchRepos(user, token),
    fetchContributions(user, token),
  ]);

  const totals = {
    publicRepos: repos.length,
    totalStars: repos.reduce((n, r) => n + r.stars, 0),
    mergedPRs: contributions.reduce((n, c) => n + c.merged, 0),
    externalRepos: contributions.length,
  };

  return {
    _comment: 'Auto-scraped from GitHub. Edit freely — the tailor treats this as an editable source of truth. Re-scrape with `npm run sync`.',
    scrapedAt: new Date().toISOString(),
    username: user,
    profileUrl: `https://github.com/${user}`,
    totals,
    repos,
    contributions,
  };
}
