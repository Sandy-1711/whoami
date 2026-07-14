import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readOnlyTools } from './readonly.js';
import type { AgentDeps } from '../deps.js';

// Vitest runs with cwd = the package dir; the repo root is two levels up. The
// read-only tools that touch disk read the committed fact base + résumé, so this
// exercises real scoring without a network.
const repoRoot = join(process.cwd(), '..', '..');

// Only score_jd / read_facts / list_outputs need deps.root; the rest of AgentDeps
// is unused by these tools, so a root-only stub is enough here.
const deps = { root: repoRoot } as unknown as AgentDeps;

async function run<T>(tool: { execute?: (input: any, ctx: any) => Promise<T> }, input: unknown): Promise<T> {
  if (!tool.execute) throw new Error('tool has no execute');
  return tool.execute(input as any, {} as any);
}

describe('readOnlyTools', () => {
  const tools = readOnlyTools(deps);

  it('exposes the expected tool ids', () => {
    expect(Object.keys(tools).sort()).toEqual(['list_outputs', 'profile_status', 'read_facts', 'score_jd']);
  });

  it('score_jd rejects a too-short JD', async () => {
    await expect(run(tools.score_jd, { jd: 'too short' })).rejects.toThrow(/too short/i);
  });

  it('score_jd scores a real JD against the fact base', async () => {
    const jd = 'We are hiring an AI Engineer to build agent infrastructure with RAG, LLM evaluation, ' +
      'FastAPI, and TypeScript. Experience with Mastra and agent orchestration is a plus.';
    const res: any = await run(tools.score_jd, { jd });
    expect(res.score.tailored).toBeGreaterThanOrEqual(res.score.current);
    expect(Array.isArray(res.matched)).toBe(true);
    // The fact base genuinely carries these, so they should classify as matched or addable.
    const covered = [...res.matched, ...res.addable].join(' ').toLowerCase();
    expect(covered).toContain('rag');
  });

  it('read_facts returns a single section when asked', async () => {
    const res: any = await run(tools.read_facts, { section: 'identity' });
    expect(res.section).toBe('identity');
    expect(res.value?.name).toBeTruthy();
  });

  it('list_outputs returns a count and array', async () => {
    const res: any = await run(tools.list_outputs, {});
    expect(typeof res.count).toBe('number');
    expect(Array.isArray(res.outputs)).toBe(true);
  });
});
