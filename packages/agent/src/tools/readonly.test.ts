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
    expect(Object.keys(tools).sort()).toEqual(['list_outputs', 'profile_status', 'read_facts', 'read_profile_digest', 'score_jd']);
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

  it('read_profile_digest returns compact text by default', async () => {
    const res: any = await run(tools.read_profile_digest, {});
    expect(typeof res.digest).toBe('string');
    // The committed scrape has GitHub data, so the digest should be non-trivial
    // but bounded (the whole point is that it is small).
    expect(res.digest.length).toBeGreaterThan(50);
    expect(res.digest.length).toBeLessThanOrEqual(3000);
  });

  it('read_profile_digest returns the structured digest with format json', async () => {
    const res: any = await run(tools.read_profile_digest, { format: 'json' });
    expect(res).toHaveProperty('github');
    expect(res).toHaveProperty('linkedin');
    if (res.github) expect(res.github.repos.length).toBeLessThanOrEqual(8);
  });

  it('read_profile_digest tolerates a root with no scrape files', async () => {
    const bare = readOnlyTools({ root: process.cwd() } as unknown as AgentDeps);
    const res: any = await run(bare.read_profile_digest, {});
    expect(res.digest).toContain('no scrape data');
  });
});
