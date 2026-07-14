// JD → requirement graph (architecture Layer 5).
//
// The LLM parses a job description into structured requirements — capabilities
// the role needs, each weighted by centrality — plus the flat ats_keywords list
// (kept so the existing deterministic ATS score in tailor/core.ts stays the
// continuity metric). The graph carries a jd_hash so a build lockfile can prove
// it was tailored against this exact JD. The coverage selector (Layer 6) scores
// evidence units against these requirements.
import type { LlmProvider } from '../ports/llm.js';
import { requirementsPrompt, REQUIREMENTS_SCHEMA, type RequirementResponse } from '../prompts.js';
import { sha } from '../profile/sources.js';

export interface Requirement {
  req: string;
  weight: number; // 0..1 centrality
}

export interface RequirementGraph {
  must_have: Requirement[];
  nice_to_have: Requirement[];
  ats_keywords: string[];
  seniority: string;
  domain: string;
  jd_hash: string;
}

const clamp01 = (n: unknown, fallback: number): number => {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
};

// Parse a JD into a requirement graph. Throws if the JD is empty or the provider
// returns nothing usable — an empty graph would silently produce a generic résumé.
export async function parseRequirements(jd: string, provider: LlmProvider): Promise<RequirementGraph> {
  const text = (jd || '').trim();
  if (!text) throw new Error('Empty job description — nothing to parse.');

  const parsed = await provider.generateJson<RequirementResponse>({
    prompt: requirementsPrompt(text),
    schema: REQUIREMENTS_SCHEMA,
  });

  const must_have = normalizeReqs(parsed?.must_have, 0.7);
  const nice_to_have = normalizeReqs(parsed?.nice_to_have, 0.3);
  if (!must_have.length && !nice_to_have.length && !(parsed?.ats_keywords?.length)) {
    throw new Error('Could not extract any requirements from the JD (check the model/quota).');
  }

  return {
    must_have,
    nice_to_have,
    ats_keywords: dedupeStrings(parsed?.ats_keywords ?? []),
    seniority: (parsed?.seniority ?? '').trim(),
    domain: (parsed?.domain ?? '').trim(),
    jd_hash: sha(text),
  };
}

// Normalize + dedupe a requirement list, clamping weights and dropping empties.
function normalizeReqs(list: { req?: string; weight?: number }[] | undefined, defaultWeight: number): Requirement[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Requirement[] = [];
  for (const item of list) {
    const req = String(item?.req ?? '').trim();
    const key = req.toLowerCase();
    if (!req || seen.has(key)) continue;
    seen.add(key);
    out.push({ req, weight: clamp01(item?.weight, defaultWeight) });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

function dedupeStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const v = String(s).trim();
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}
