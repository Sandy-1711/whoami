import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { factsTools } from './facts.js';
import { denyGate, allowGate } from '../confirm.js';
import type { AgentDeps } from '../deps.js';

let root: string;
const factsPath = () => join(root, 'profile', 'facts.json');

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'resume-facts-'));
  await mkdir(join(root, 'profile'), { recursive: true });
  await writeFile(factsPath(), JSON.stringify({
    identity: { name: 'Sandeep Singh', email: 'sandy@example.com' },
    allowed_keywords: ['RAG'],
    skills: { 'AI/ML & LLM': ['RAG'] },
  }, null, 2));
});

const run = (deps: Partial<AgentDeps>, input: unknown): Promise<any> => {
  const tool = factsTools({ root, ...deps } as AgentDeps).update_facts as { execute: (i: any, c: any) => Promise<any> };
  return tool.execute(input, {});
};

const readFacts = async () => JSON.parse(await readFile(factsPath(), 'utf8'));

describe('update_facts', () => {
  it('applies a batch of edits in one write', async () => {
    const res = await run({ confirm: allowGate }, {
      edits: [
        { op: 'add_keyword', value: 'LangGraph' },
        { op: 'add_skill', value: 'Mastra', category: 'AI/ML & LLM' },
      ],
    });

    expect(res.changed).toBe(true);
    const facts = await readFacts();
    expect(facts.allowed_keywords).toContain('LangGraph');
    expect(facts.skills['AI/ML & LLM']).toContain('Mastra');
  });

  it('writes nothing when a later edit in the batch is invalid', async () => {
    const before = await readFile(factsPath(), 'utf8');
    await expect(run({ confirm: denyGate }, {
      edits: [
        { op: 'add_keyword', value: 'LangGraph' },
        { op: 'add_skill', value: 'Mastra' },
      ],
    })).rejects.toThrow(/category/i);

    expect(await readFile(factsPath(), 'utf8')).toBe(before);
  });

  it('writes nothing when the user declines', async () => {
    const before = await readFile(factsPath(), 'utf8');
    const res = await run({ confirm: denyGate }, { edits: [{ op: 'add_keyword', value: 'LangGraph' }] });

    expect(res.changed).toBe(false);
    expect(await readFile(factsPath(), 'utf8')).toBe(before);
  });

  it('warns in the prompt when a batch touches identity', async () => {
    const requests: any[] = [];
    await run({ confirm: async (r) => { requests.push(r); return false; } }, {
      edits: [
        { op: 'add_keyword', value: 'LangGraph' },
        { op: 'set_identity', field: 'email', value: 'new@example.com' },
      ],
    });

    expect(requests[0].params.identity).toMatch(/verified identity/i);
    expect(requests[0].preview).toMatch(/new@example\.com/);
  });

  it('writes the identity edit once confirmed', async () => {
    await run({ confirm: allowGate }, {
      edits: [{ op: 'set_identity', field: 'email', value: 'new@example.com' }],
    });
    expect((await readFacts()).identity.email).toBe('new@example.com');
  });

  it('reports a no-op batch without touching the file', async () => {
    const res = await run({ confirm: denyGate }, { edits: [{ op: 'add_keyword', value: 'RAG' }] });
    expect(res.changed).toBe(false);
    expect(res.summary).toMatch(/already present/i);
  });
});
