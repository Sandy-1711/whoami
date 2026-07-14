import { describe, it, expect } from 'vitest';
import { extractUnits } from './extract.js';
import type { SourceRecord } from './normalize.js';
import type { LlmProvider, LlmRequest } from '../ports/llm.js';
import type { ExtractResponse } from '../prompts.js';

const record: SourceRecord = { source: 'github', ref: 'whoami', title: 't', text: 'a résumé toolkit' };

function provider(res: ExtractResponse | Error): LlmProvider {
  return {
    id: 'fake', label: 'Fake', model: 'm',
    async generateJson<T>(_r: LlmRequest): Promise<T> {
      if (res instanceof Error) throw res;
      return res as unknown as T;
    },
  };
}

describe('extractUnits', () => {
  it('shapes and cleans claims, dropping empties and deduping skills', async () => {
    const units = await extractUnits(record, provider({
      units: [
        { claim: '  Built a CLI  ', skills: ['TypeScript', 'typescript', ' '], domains: ['cli'], impact: { metric: 'users', value: '10000' } },
        { claim: '   ', skills: ['x'] }, // dropped: empty claim
      ],
    }));
    expect(units).toHaveLength(1);
    expect(units[0].claim).toBe('Built a CLI');
    expect(units[0].skills).toEqual(['TypeScript']);
    expect(units[0].impact).toEqual({ metric: 'users', value: '10000' });
  });

  it('drops an impact with neither metric nor value', async () => {
    const units = await extractUnits(record, provider({ units: [{ claim: 'c', impact: { scope: 'x' } }] }));
    expect(units[0].impact).toBeUndefined();
  });

  it('returns [] on an empty/garbled response', async () => {
    const units = await extractUnits(record, provider({} as ExtractResponse));
    expect(units).toEqual([]);
  });

  it('propagates a provider failure to the caller', async () => {
    await expect(extractUnits(record, provider(new Error('quota')))).rejects.toThrow(/quota/);
  });
});
