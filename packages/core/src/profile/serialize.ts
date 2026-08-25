import type { Facts } from '../types.js';

/**
 * Ceiling on the serialized fact base, in characters.
 *
 * A safety net against a runaway fact base, not a working constraint: the whole
 * file is roughly 16 KB (~4k tokens) against context windows measured in the
 * hundreds of thousands, so nothing should ever be dropped in practice.
 */
export const DEFAULT_FACTS_BUDGET = 40_000;

/**
 * Sections in the order they earn their place in a prompt, most load-bearing
 * first. `headline_metrics` ranks high because the copy prompts instruct the
 * model to lead with a metric and to draw achievements from it. `allowed_keywords`
 * ranks last because the keyword analysis block already passes the matched,
 * addable and missing sets separately.
 */
const SECTION_PRIORITY: (keyof Facts)[] = [
  'identity',
  'headline_metrics',
  'experience',
  'projects',
  'skills',
  'title_variants',
  'seniority',
  'allowed_keywords',
];

export interface SerializedFacts {
  /** Always parseable JSON. Never a mid-value truncation. */
  json: string;
  /** Sections left out to stay inside the budget, in the order they were dropped. */
  dropped: string[];
}

/**
 * Render the fact base for a prompt, dropping whole sections when it cannot fit.
 *
 * Sections are all-or-nothing so the result is always valid JSON. A caller that
 * gets a non-empty `dropped` should surface it — silently sending the model less
 * than it was told it has is how a prompt ends up asking for metrics that were
 * never included.
 */
export function serializeFacts(facts: Facts, budget = DEFAULT_FACTS_BUDGET): SerializedFacts {
  const full = JSON.stringify(facts);
  if (full.length <= budget) return { json: full, dropped: [] };

  const keys = Object.keys(facts) as (keyof Facts)[];
  const ordered = [
    ...SECTION_PRIORITY.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !SECTION_PRIORITY.includes(k)),
  ];

  const kept: Partial<Facts> = {};
  const dropped: string[] = [];
  for (const key of ordered) {
    if (facts[key] === undefined) continue;
    const candidate = { ...kept, [key]: facts[key] };
    if (JSON.stringify(candidate).length <= budget) Object.assign(kept, candidate);
    else dropped.push(key);
  }

  return { json: JSON.stringify(kept), dropped };
}
