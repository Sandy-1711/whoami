import { describe, it, expect } from 'vitest';
import { parseRequirements } from './requirements.js';
import { sha } from '../profile/sources.js';
import type { LlmProvider, LlmRequest } from '../ports/llm.js';
import type { RequirementResponse } from '../prompts.js';

function provider(res: RequirementResponse | Error): LlmProvider {
  return {
    id: 'fake', label: 'Fake', model: 'm',
    async generateJson<T>(_r: LlmRequest): Promise<T> {
      if (res instanceof Error) throw res;
      return res as unknown as T;
    },
  };
}

describe('parseRequirements', () => {
  it('normalizes requirements, dedupes, clamps weights, and sorts by weight', async () => {
    const graph = await parseRequirements('build agents', provider({
      must_have: [
        { req: 'Operate LLM agent pipelines', weight: 1 },
        { req: 'operate llm agent pipelines', weight: 0.5 }, // dupe (case) → dropped
        { req: 'Backend APIs', weight: 5 }, // out of range → clamped to 1
        { req: '  ', weight: 0.9 }, // empty → dropped
      ],
      nice_to_have: [{ req: 'Kubernetes' }], // no weight → default
      ats_keywords: ['FastAPI', 'fastapi', 'RAG'],
      seniority: 'mid',
      domain: 'AI agent infrastructure',
    }));

    expect(graph.must_have.map((r) => r.req)).toEqual(['Operate LLM agent pipelines', 'Backend APIs']);
    expect(graph.must_have[1].weight).toBe(1); // clamped
    expect(graph.nice_to_have[0].weight).toBe(0.3); // default applied
    expect(graph.ats_keywords).toEqual(['FastAPI', 'RAG']); // case-insensitive dedupe
    expect(graph.seniority).toBe('mid');
    expect(graph.domain).toBe('AI agent infrastructure');
  });

  it('stamps a jd_hash of the trimmed JD text', async () => {
    const graph = await parseRequirements('  Senior AI Engineer  ', provider({
      must_have: [{ req: 'x', weight: 0.8 }], nice_to_have: [], ats_keywords: [], seniority: '', domain: '',
    }));
    expect(graph.jd_hash).toBe(sha('Senior AI Engineer'));
  });

  it('throws on an empty JD', async () => {
    await expect(parseRequirements('   ', provider({}))).rejects.toThrow(/empty/i);
  });

  it('throws when the model returns nothing usable', async () => {
    await expect(parseRequirements('a real jd', provider({ must_have: [], nice_to_have: [], ats_keywords: [] })))
      .rejects.toThrow(/could not extract/i);
  });
});
