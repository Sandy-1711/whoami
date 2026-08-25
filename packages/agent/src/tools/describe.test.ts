import { describe, it, expect } from 'vitest';
import { describeTool } from './describe.js';
import { assembleTools } from '../agent.js';
import type { AgentDeps } from '../deps.js';

describe('describeTool', () => {
  it('renders the labelled lines a caller compares tools on', () => {
    expect(describeTool({
      does: 'Do the thing.',
      cost: 'llm',
      use: 'the thing is wanted.',
      avoid: 'the other thing — that is other_tool.',
      needs: 'a key.',
      then: 'next_tool.',
    })).toBe([
      'Do the thing.',
      'COST: SPENDS LLM CREDITS.',
      'USE WHEN: the thing is wanted.',
      'NOT FOR: the other thing — that is other_tool.',
      'NEEDS: a key.',
      'THEN: next_tool.',
    ].join('\n'));
  });

  it('omits the optional lines rather than emitting empty ones', () => {
    expect(describeTool({ does: 'Read a file.', cost: 'free', use: 'you need the file.' }))
      .toBe('Read a file.\nCOST: free — no model call, no network.\nUSE WHEN: you need the file.');
  });
});

describe('the tool surface', () => {
  // An MCP client picks a tool by reading these side by side, so every one has
  // to answer the same questions. A description that drifts back to a prose
  // blob is invisible in review and obvious here.
  const tools = assembleTools({ root: process.cwd() } as unknown as AgentDeps);

  it('states a cost and a when-to-use for every tool', () => {
    for (const [id, tool] of Object.entries(tools)) {
      const description = (tool as { description?: string }).description ?? '';
      expect(description, `${id} has no COST line`).toMatch(/^COST: /m);
      expect(description, `${id} has no USE WHEN line`).toMatch(/^USE WHEN: /m);
    }
  });

  it('says outright which tools spend credits or reach outside this machine', () => {
    const costOf = (id: string) => ((tools as Record<string, { description?: string }>)[id]?.description ?? '')
      .split('\n').find((l) => l.startsWith('COST: ')) ?? '';

    for (const id of ['tailor_plan', 'tailor_render', 'outreach_message', 'draft_application_email']) {
      expect(costOf(id), id).toMatch(/SPENDS LLM CREDITS/);
    }
    for (const id of ['send_application_email', 'update_github_profile']) {
      expect(costOf(id), id).toMatch(/not reversible/);
    }
    for (const id of ['score_jd', 'read_profile', 'list_applications', 'ask_user']) {
      expect(costOf(id), id).toMatch(/free/);
    }
  });
});
