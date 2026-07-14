// Validated, in-place edits to the fact base. The agent's update_facts tool uses
// this to add a keyword, a skill, a headline metric, a title variant, or to fix
// an identity field — WITHOUT letting the model rewrite the file freely. Every
// edit is a small, typed operation; the function validates it, dedupes, and
// returns the new facts plus a human summary. It never writes to disk (the caller
// does) and never invents content.
import type { Facts } from '../types.js';

export const IDENTITY_FIELDS = [
  'name', 'location', 'email', 'github', 'linkedin', 'portfolio', 'graduation',
] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

export type FactsEdit =
  | { op: 'add_keyword'; value: string }
  | { op: 'remove_keyword'; value: string }
  | { op: 'add_skill'; category: string; value: string }
  | { op: 'remove_skill'; category: string; value: string }
  | { op: 'add_headline_metric'; value: string }
  | { op: 'remove_headline_metric'; value: string }
  | { op: 'add_title_variant'; value: string }
  | { op: 'remove_title_variant'; value: string }
  | { op: 'set_identity'; field: IdentityField; value: string };

export interface FactsEditResult {
  facts: Facts;
  changed: boolean;
  summary: string;
  // True when the edit touches an identity field — the caller should gate it.
  identity: boolean;
}

const eq = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

// Add to a string array with case-insensitive dedup; optionally keep it sorted.
function addUnique(arr: string[], value: string, sort = false): { arr: string[]; added: boolean } {
  const v = value.trim();
  if (arr.some((x) => eq(x, v))) return { arr, added: false };
  const next = [...arr, v];
  if (sort) next.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return { arr: next, added: true };
}

function removeWhere(arr: string[], value: string): { arr: string[]; removed: boolean } {
  const next = arr.filter((x) => !eq(x, value));
  return { arr: next, removed: next.length !== arr.length };
}

// Apply one edit to a COPY of facts. Throws on invalid input; returns
// changed:false (with an explanatory summary) for no-op edits like a duplicate.
export function applyFactsEdit(input: Facts, edit: FactsEdit): FactsEditResult {
  const facts: Facts = structuredClone(input);
  const val = 'value' in edit ? (edit.value ?? '').trim() : '';
  if ('value' in edit && !val) throw new Error('Empty value — nothing to add or remove.');

  switch (edit.op) {
    case 'add_keyword': {
      const list = facts.allowed_keywords ?? (facts.allowed_keywords = []);
      const { arr, added } = addUnique(list, val);
      facts.allowed_keywords = arr;
      return { facts, changed: added, identity: false, summary: added ? `Added keyword "${val}".` : `Keyword "${val}" already present.` };
    }
    case 'remove_keyword': {
      const { arr, removed } = removeWhere(facts.allowed_keywords ?? [], val);
      facts.allowed_keywords = arr;
      return { facts, changed: removed, identity: false, summary: removed ? `Removed keyword "${val}".` : `Keyword "${val}" not found.` };
    }
    case 'add_skill': {
      const cat = edit.category?.trim();
      if (!cat) throw new Error('A skill needs a category (e.g. "AI/ML & LLM", "Backend & Ops", "Languages").');
      facts.skills = facts.skills ?? {};
      const created = !(cat in facts.skills);
      const { arr, added } = addUnique(facts.skills[cat] ?? [], val, true);
      facts.skills[cat] = arr;
      return { facts, changed: added || created, identity: false, summary: added ? `Added skill "${val}" to ${cat}${created ? ' (new category)' : ''}.` : `Skill "${val}" already in ${cat}.` };
    }
    case 'remove_skill': {
      const cat = edit.category?.trim();
      if (!cat || !facts.skills?.[cat]) throw new Error(`No skill category "${edit.category}".`);
      const { arr, removed } = removeWhere(facts.skills[cat]!, val);
      facts.skills[cat] = arr;
      return { facts, changed: removed, identity: false, summary: removed ? `Removed skill "${val}" from ${cat}.` : `Skill "${val}" not found in ${cat}.` };
    }
    case 'add_headline_metric': {
      const { arr, added } = addUnique(facts.headline_metrics ?? [], val);
      facts.headline_metrics = arr;
      return { facts, changed: added, identity: false, summary: added ? `Added headline metric.` : `That metric is already present.` };
    }
    case 'remove_headline_metric': {
      const { arr, removed } = removeWhere(facts.headline_metrics ?? [], val);
      facts.headline_metrics = arr;
      return { facts, changed: removed, identity: false, summary: removed ? `Removed headline metric.` : `Metric not found.` };
    }
    case 'add_title_variant': {
      const { arr, added } = addUnique(facts.title_variants ?? [], val);
      facts.title_variants = arr;
      return { facts, changed: added, identity: false, summary: added ? `Added title variant "${val}".` : `Title variant "${val}" already present.` };
    }
    case 'remove_title_variant': {
      const { arr, removed } = removeWhere(facts.title_variants ?? [], val);
      facts.title_variants = arr;
      return { facts, changed: removed, identity: false, summary: removed ? `Removed title variant "${val}".` : `Title variant "${val}" not found.` };
    }
    case 'set_identity': {
      if (!IDENTITY_FIELDS.includes(edit.field)) throw new Error(`Unknown identity field "${edit.field}".`);
      facts.identity = facts.identity ?? {};
      const prev = facts.identity[edit.field] ?? '';
      if (eq(String(prev), val)) return { facts, changed: false, identity: true, summary: `Identity ${edit.field} already "${val}".` };
      facts.identity[edit.field] = val;
      return { facts, changed: true, identity: true, summary: `Set identity ${edit.field} to "${val}" (was "${prev || '(unset)'}").` };
    }
  }
}
