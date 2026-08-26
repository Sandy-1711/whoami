import { describe, expect, it } from 'vitest';
import { applyResumeEdit, type ResumeEdit } from './edit.js';
import { parseResume } from './schema.js';
import type { Facts } from '../types.js';

const FACTS: Facts = {
  allowed_keywords: ['RAG', 'FastAPI', 'TypeScript'],
  headline_metrics: ['16 merged PRs into Mastra'],
};

const RESUME = parseResume({
  name: 'Sandeep Singh',
  subtitle: ['AI Engineer'],
  contacts: ['[mail](mailto:x@y.dev)'],
  summary: 'Builds agentic LLM systems.',
  experience: [
    {
      id: 'aira',
      org: 'AiRA',
      role: 'AI Engineer',
      bullets: [{ id: 'aira-1', text: 'Shipped RAG agents on FastAPI.' }],
    },
  ],
});

const EDIT: ResumeEdit = {
  roleTitle: 'AI Dev Engineer',
  summary: 'Ships **RAG** agents on **FastAPI**.',
  subtitle: ['AI Engineer', 'RAG Systems'],
  bullets: [{ id: 'aira-1', text: 'Shipped **RAG** agents on **FastAPI**, in production.' }],
  rationale: 'closer to the JD',
};

describe('applyResumeEdit', () => {
  it('takes a rewrite the fact base backs', () => {
    const { resume, applied } = applyResumeEdit(RESUME, EDIT, FACTS);
    expect(resume.summary).toBe(EDIT.summary);
    expect(resume.subtitle).toEqual(['AI Engineer', 'RAG Systems']);
    expect(resume.experience[0]!.bullets[0]!.text).toBe(EDIT.bullets[0]!.text);
    expect(applied).toEqual(['summary', 'subtitle', 'aira-1']);
  });

  it('keeps the original line when the rewrite claims something unbacked', () => {
    const invented = {
      ...EDIT,
      bullets: [{ id: 'aira-1', text: 'Shipped agents on **Kubernetes**.' }],
    };
    const { resume, reverted, applied } = applyResumeEdit(RESUME, invented, FACTS);
    expect(resume.experience[0]!.bullets[0]!.text).toBe('Shipped RAG agents on FastAPI.');
    expect(reverted).toEqual([{ id: 'aira-1', unbacked: ['Kubernetes'] }]);
    expect(applied).not.toContain('aira-1');
  });

  it('reports an edit to a line the document does not have', () => {
    const stray = { ...EDIT, bullets: [{ id: 'ghost-9', text: 'Did a thing.' }] };
    expect(applyResumeEdit(RESUME, stray, FACTS).unknown).toEqual(['ghost-9']);
  });

  it('leaves the document it was given untouched', () => {
    applyResumeEdit(RESUME, EDIT, FACTS);
    expect(RESUME.summary).toBe('Builds agentic LLM systems.');
    expect(RESUME.experience[0]!.bullets[0]!.text).toBe('Shipped RAG agents on FastAPI.');
  });
});
