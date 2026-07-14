// The evidence quality gate (architecture Layer 2).
//
// Two stages, cheap-first to keep LLM calls bounded:
//   Stage A — pure heuristics over GithubRepo fields (fork, archived, description,
//     stars, recency, README size, topics) → a 0..1 quality score and a survive
//     verdict. Forks and thin/stale repos are filtered here for free.
//   Stage B — an LLM judge (prompts.gatePrompt) runs ONLY on Stage-A survivors,
//     confirming each is real, résumé-worthy engineering and refining the score.
//
// Contributions (external merged PRs) never enter the gate — a merged PR into
// Mastra/cal.com/n8n is inherently high-signal, so ingest treats them as always
// surviving. This module is repo-only.
import type { LlmProvider } from '../ports/llm.js';
import type { GithubRepo } from '../types.js';
import { gatePrompt, GATE_SCHEMA, type GateResponse, type GateJudgement } from '../prompts.js';

// Stage-A survival cutoff. Below this a repo is dropped before the LLM ever sees it.
export const GATE_THRESHOLD = 0.35;

const MONTH_MS = 1000 * 60 * 60 * 24 * 30;

export interface RepoQuality {
  name: string;
  score: number;     // 0..1 heuristic quality
  survives: boolean; // passed Stage A
  reasons: string[]; // human-readable signals behind the score
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

// Stage A: score one repo from its metadata alone. `now` is injectable so
// recency scoring is deterministic in tests.
export function scoreRepo(repo: GithubRepo, now: Date = new Date()): RepoQuality {
  const reasons: string[] = [];

  // Component signals, each 0..1.
  const substance = clamp01((repo.readmeSize || 0) / 2000); // ~2KB README = full marks
  const described = repo.description?.trim() ? 1 : 0;
  const popularity = clamp01(Math.log10((repo.stars || 0) + 1) / 2); // ~100 stars = full
  const months = Math.max(0, (now.getTime() - new Date(repo.pushedAt).getTime()) / MONTH_MS);
  const recency = clamp01(1 - Math.max(0, months - 6) / 18); // fresh <6mo, 0 by ~24mo
  const topical = clamp01((repo.topics?.length || 0) / 3);

  let score =
    0.3 * substance + 0.2 * described + 0.2 * recency + 0.2 * popularity + 0.1 * topical;

  if (!described) reasons.push('no description');
  if ((repo.readmeSize || 0) < 300) reasons.push('thin or missing README');
  if (months > 24) reasons.push(`stale (${Math.round(months)}mo)`);
  if ((repo.stars || 0) > 0) reasons.push(`${repo.stars}★`);

  // Hard penalties: forks and archives are rarely original résumé evidence.
  if (repo.archived) {
    score *= 0.6;
    reasons.push('archived');
  }
  if (repo.fork) {
    score *= 0.2;
    reasons.push('fork');
  }

  score = clamp01(score);
  const survives = !repo.fork && score >= GATE_THRESHOLD;
  return { name: repo.name, score, survives, reasons };
}

export interface HeuristicGateResult {
  survivors: GithubRepo[];
  rejected: RepoQuality[];
  // Every repo's Stage-A verdict, keyed by name (survivors included).
  scores: Record<string, RepoQuality>;
}

// Stage A over a set of repos.
export function heuristicGate(repos: GithubRepo[], now: Date = new Date()): HeuristicGateResult {
  const survivors: GithubRepo[] = [];
  const rejected: RepoQuality[] = [];
  const scores: Record<string, RepoQuality> = {};
  for (const repo of repos) {
    const q = scoreRepo(repo, now);
    scores[repo.name] = q;
    if (q.survives) survivors.push(repo);
    else rejected.push(q);
  }
  return { survivors, rejected, scores };
}

export interface JudgedRepo {
  repo: GithubRepo;
  keep: boolean;
  quality: number; // blend of heuristic + LLM
  reason: string;
}

export interface GateResult {
  kept: JudgedRepo[];
  dropped: JudgedRepo[];
  rejected: RepoQuality[]; // never reached Stage B (failed Stage A)
}

// Full gate: Stage A, then the LLM judge on survivors only. The final quality is
// the mean of the heuristic score and the judge's score (both 0..1); a repo is
// kept only if it survived Stage A AND the judge kept it. If the LLM call fails,
// we fall back to the heuristic verdict so ingest can still proceed.
export async function runQualityGate(
  repos: GithubRepo[],
  provider: LlmProvider,
  now: Date = new Date(),
): Promise<GateResult> {
  const stageA = heuristicGate(repos, now);
  if (!stageA.survivors.length) {
    return { kept: [], dropped: [], rejected: stageA.rejected };
  }

  let judgements: Record<string, GateJudgement> = {};
  try {
    const parsed = await provider.generateJson<GateResponse>({
      prompt: gatePrompt(
        stageA.survivors.map((r) => ({
          name: r.name,
          description: r.description,
          language: r.language,
          topics: r.topics,
          stars: r.stars,
          readmeSize: r.readmeSize,
          pushedAt: r.pushedAt,
        })),
      ),
      schema: GATE_SCHEMA,
    });
    for (const j of parsed?.repos ?? []) judgements[j.name] = j;
  } catch {
    judgements = {}; // fall back to heuristics below
  }

  const kept: JudgedRepo[] = [];
  const dropped: JudgedRepo[] = [];
  for (const repo of stageA.survivors) {
    const h = stageA.scores[repo.name].score;
    const j = judgements[repo.name];
    // No judgement (LLM failed or omitted it) → trust Stage A.
    const keep = j ? j.keep : true;
    const quality = j ? clamp01((h + clamp01(j.quality)) / 2) : h;
    const reason = j?.reason?.trim() || stageA.scores[repo.name].reasons.join(', ') || 'heuristic pass';
    (keep ? kept : dropped).push({ repo, keep, quality, reason });
  }
  kept.sort((a, b) => b.quality - a.quality);
  return { kept, dropped, rejected: stageA.rejected };
}
