import { describe, it, expect } from 'vitest';
import { applyFactsEdit } from './facts-editor.js';
import type { Facts } from '../types.js';

const base = (): Facts => ({
  identity: { name: 'Sandeep Singh', email: 'a@b.com' },
  title_variants: ['AI Engineer'],
  allowed_keywords: ['RAG', 'LLM'],
  skills: { Languages: ['Python', 'TypeScript'] },
  headline_metrics: ['shipped agents'],
});

describe('applyFactsEdit', () => {
  it('adds a new keyword and dedupes case-insensitively', () => {
    const added = applyFactsEdit(base(), { op: 'add_keyword', value: 'Kubernetes' });
    expect(added.changed).toBe(true);
    expect(added.facts.allowed_keywords).toContain('Kubernetes');
    const dupe = applyFactsEdit(base(), { op: 'add_keyword', value: 'rag' });
    expect(dupe.changed).toBe(false);
  });

  it('adds a skill to a category, sorted, and creates a category when needed', () => {
    const r = applyFactsEdit(base(), { op: 'add_skill', category: 'Languages', value: 'Go' });
    expect(r.facts.skills!.Languages).toEqual(['Go', 'Python', 'TypeScript']);
    const created = applyFactsEdit(base(), { op: 'add_skill', category: 'Cloud', value: 'AWS' });
    expect(created.changed).toBe(true);
    expect(created.facts.skills!.Cloud).toEqual(['AWS']);
  });

  it('removes a skill and reports a miss', () => {
    const r = applyFactsEdit(base(), { op: 'remove_skill', category: 'Languages', value: 'Python' });
    expect(r.facts.skills!.Languages).toEqual(['TypeScript']);
    const miss = applyFactsEdit(base(), { op: 'remove_skill', category: 'Languages', value: 'Rust' });
    expect(miss.changed).toBe(false);
  });

  it('sets an identity field and flags it as identity', () => {
    const r = applyFactsEdit(base(), { op: 'set_identity', field: 'location', value: 'Bengaluru' });
    expect(r.identity).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.facts.identity!.location).toBe('Bengaluru');
  });

  it('does not mutate the input', () => {
    const input = base();
    applyFactsEdit(input, { op: 'add_keyword', value: 'Kubernetes' });
    expect(input.allowed_keywords).toEqual(['RAG', 'LLM']);
  });

  it('throws on empty value and unknown category', () => {
    expect(() => applyFactsEdit(base(), { op: 'add_keyword', value: '  ' })).toThrow(/empty/i);
    expect(() => applyFactsEdit(base(), { op: 'remove_skill', category: 'Nope', value: 'x' })).toThrow(/category/i);
  });
});
