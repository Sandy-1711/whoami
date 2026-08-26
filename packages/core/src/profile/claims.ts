// Which claims in a piece of generated copy the fact base does not back.
//
// Two kinds are checked, because they are the two that get invented:
// technologies (from the shared lexicon) and figures (a number with its unit).
// A claim is backed when the fact base holds it, or when the text being
// rewritten already made it — a rewrite must not be able to add a claim the
// original did not make, while staying free to keep the ones it did.
//
// The lexicon is the limit: a technology this repo has never named anywhere
// passes unseen. That is the same vocabulary JD scoring reasons in, so widening
// it widens both at once.
import { extractJdKeywords, factIndex, termInText } from '../tailor/core.js';
import type { Facts } from '../types.js';

// "82%", "10,000+", "27k+", "8+", "4B", "99.9%".
const FIGURE = /\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|x|%)?\+?/gi;

function figures(text: string): Set<string> {
  const found = (text.match(FIGURE) || []).map((f) => f.replace(/[\s,]/g, '').toLowerCase());
  return new Set(found);
}

export interface ClaimContext {
  facts: Facts;
  /** The text being rewritten. Whatever it already claimed stays backed. */
  source?: string;
}

/** The terms and figures in `text` that neither the fact base nor `source` supports. */
export function unbackedClaims(text: string, { facts, source = '' }: ClaimContext): string[] {
  const index = factIndex(facts);
  const unbacked: string[] = [];

  for (const term of extractJdKeywords(text)) {
    if (!index.has(term.toLowerCase()) && !termInText(term, source)) unbacked.push(term);
  }

  const known = figures(source + ' ' + JSON.stringify(facts));
  for (const figure of figures(text)) {
    if (!known.has(figure)) unbacked.push(figure);
  }

  return [...new Set(unbacked)];
}
