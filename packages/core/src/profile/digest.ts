// The profile digest: a deterministic, LLM-free distillation of the scraped
// GitHub + LinkedIn sources into the ~2 KB of evidence actually worth showing
// a model. github.json holds 60+ repos, most of them forks and zero-star
// experiments; feeding it raw would bury the handful that matter. The digest
// selects and ranks:
//   - top repos: curation pins first (in pin order), then non-fork,
//     non-archived repos by a transparent score (stars, recency, description),
//   - external contributions with merged PRs (the "12 merged PRs into
//     mastra-ai/mastra" evidence), with sample PR titles,
//   - one line per LinkedIn role plus the headline.
// The digest is EVIDENCE for choosing what to emphasize — facts.json remains
// the only source of claims a prompt may make.
import type { GithubData, GithubTotals, LinkedinData } from '../types.js';
import { type Curation, EMPTY_CURATION, applyCuration } from './curation.js';

export const DIGEST_REPO_CAP = 8;
export const DIGEST_CONTRIBUTION_CAP = 5;
export const DIGEST_PR_TITLE_CAP = 2;
const DESCRIPTION_CLAMP = 110;
const PR_TITLE_CLAMP = 80;
const ROLE_LINE_CLAMP = 140;

export interface DigestRepo {
  name: string;
  description: string;
  url: string;
  stars: number;
  language: string;
  topics: string[];
  pushedAt: string;
  pinned: boolean;
}

export interface DigestContribution {
  repo: string;
  url: string;
  merged: number;
  stars?: number;
  topPrTitles: string[];
}

export interface DigestRole {
  company: string;
  title: string;
  dates?: string;
  oneLiner: string;
}

export interface ProfileDigest {
  github: {
    username: string;
    totals: GithubTotals;
    repos: DigestRepo[];
    contributions: DigestContribution[];
  } | null;
  linkedin: { headline: string; roles: DigestRole[] } | null;
}

const clamp = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';

// First sentence of a blob of prose, for the one-line role summaries.
const firstSentence = (s: string): string => {
  const text = s.replace(/\s+/g, ' ').trim();
  const m = /(?<=[.!?])\s/.exec(text);
  return clamp(m ? text.slice(0, m.index) : text, ROLE_LINE_CLAMP);
};

// Ranking score for unpinned repos. Deliberately simple and transparent:
// stars dominate, a recent push and a real description break ties upward.
function repoScore(repo: { stars: number; pushedAt: string; description: string }, now: number): number {
  const ageDays = (now - Date.parse(repo.pushedAt)) / 86_400_000;
  const recency = Number.isFinite(ageDays) ? (ageDays <= 90 ? 4 : ageDays <= 365 ? 2 : 0) : 0;
  return repo.stars * 3 + recency + (repo.description?.trim() ? 2 : 0);
}

export function buildProfileDigest(
  github: GithubData | null,
  linkedin: LinkedinData | null,
  curation: Curation = EMPTY_CURATION,
  now: number = Date.now(),
): ProfileDigest {
  let gh: ProfileDigest['github'] = null;
  if (github) {
    // github.json is already ban-filtered at write time, but apply again so a
    // read-time curation edit takes effect immediately (idempotent).
    const curated = applyCuration(github, curation);

    const pinned = curated.repos.filter((r) => r.pinned);
    const rest = curated.repos
      .filter((r) => !r.pinned && !r.fork && !r.archived)
      .map((r) => ({ repo: r, score: repoScore(r, now) }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          Date.parse(b.repo.pushedAt) - Date.parse(a.repo.pushedAt) ||
          a.repo.name.localeCompare(b.repo.name),
      )
      .map((x) => x.repo);

    const repos = [...pinned, ...rest].slice(0, DIGEST_REPO_CAP).map((r): DigestRepo => ({
      name: r.name,
      description: clamp(r.description?.trim() ?? '', DESCRIPTION_CLAMP),
      url: r.url,
      stars: r.stars,
      language: r.language,
      topics: r.topics,
      pushedAt: r.pushedAt,
      pinned: Boolean(r.pinned),
    }));

    const contributions = curated.contributions
      .filter((c) => c.merged > 0)
      .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.merged - a.merged)
      .slice(0, DIGEST_CONTRIBUTION_CAP)
      .map((c): DigestContribution => ({
        repo: c.repo,
        url: c.url,
        merged: c.merged,
        ...(c.stars !== undefined ? { stars: c.stars } : {}),
        topPrTitles: [...c.samplePRs]
          .sort((a, b) => Number(b.state === 'merged') - Number(a.state === 'merged'))
          .slice(0, DIGEST_PR_TITLE_CAP)
          .map((pr) => clamp(pr.title, PR_TITLE_CLAMP)),
      }));

    gh = { username: curated.username, totals: curated.totals, repos, contributions };
  }

  let li: ProfileDigest['linkedin'] = null;
  if (linkedin) {
    li = {
      headline: linkedin.profile.headline ?? '',
      roles: (linkedin.profile.experience ?? []).map((e): DigestRole => ({
        company: e.company,
        title: e.title,
        ...(e.dates ? { dates: e.dates } : {}),
        oneLiner: e.description ? firstSentence(e.description) : '',
      })),
    };
  }

  return { github: gh, linkedin: li };
}

// Compact plain-text rendering for prompt injection and `resume digest`.
// Target ≤ ~2 KB; returns '' when there is no scrape data at all.
export function renderProfileDigest(digest: ProfileDigest): string {
  const lines: string[] = [];

  if (digest.github) {
    const { totals, repos, contributions } = digest.github;
    lines.push(
      `GitHub (${digest.github.username}): ${totals.publicRepos} repos · ${totals.totalStars}★ · ${totals.mergedPRs} merged PRs in ${totals.externalRepos} external repos`,
    );
    if (repos.length) {
      lines.push('Top repos:');
      for (const r of repos) {
        const meta = [r.language, r.pinned ? 'pinned' : ''].filter(Boolean).join(', ');
        const pushed = r.pushedAt?.slice(0, 7);
        lines.push(
          `- ${r.name} ★${r.stars}${meta ? ` (${meta})` : ''}${r.description ? ` — ${r.description}` : ''}${pushed ? ` [pushed ${pushed}]` : ''}`,
        );
      }
    }
    if (contributions.length) {
      lines.push('External contributions (merged PRs):');
      for (const c of contributions) {
        const star = c.stars !== undefined ? ` (${c.stars.toLocaleString('en-US')}★ repo)` : '';
        const prs = c.topPrTitles.length ? `: ${c.topPrTitles.map((t) => `"${t}"`).join('; ')}` : '';
        lines.push(`- ${c.repo} — ${c.merged} merged${star}${prs}`);
      }
    }
  }

  if (digest.linkedin) {
    if (lines.length) lines.push('');
    lines.push(`LinkedIn: ${digest.linkedin.headline}`);
    for (const role of digest.linkedin.roles) {
      const dates = role.dates ? ` (${role.dates})` : '';
      lines.push(`- ${role.title}, ${role.company}${dates}${role.oneLiner ? ` — ${role.oneLiner}` : ''}`);
    }
  }

  return lines.join('\n');
}
