import { describe, it, expect, vi } from 'vitest';
import { askTools } from './ask.js';
import type { AgentDeps } from '../deps.js';

const QUESTIONS = [{ id: 'tone', question: 'How formal?', options: ['warm', 'formal'], why: 'sets the register' }];

const run = (deps: Partial<AgentDeps>, input: unknown): Promise<any> => {
  const tool = askTools(deps as AgentDeps).ask_user as { execute: (i: any, c: any) => Promise<any> };
  return tool.execute(input, {});
};

describe('ask_user', () => {
  it('puts the questions to the user when a human is reachable', async () => {
    const ask = vi.fn(async () => [{ id: 'tone', answer: 'warm' }]);
    const res = await run({ ask }, { questions: QUESTIONS });

    expect(ask).toHaveBeenCalledWith(QUESTIONS);
    expect(res).toEqual({ answered: true, answers: [{ id: 'tone', answer: 'warm' }] });
  });

  it('hands the questions back when there is no one to ask', async () => {
    const res = await run({}, { questions: QUESTIONS });

    expect(res.answered).toBe(false);
    expect(res.questions).toEqual(QUESTIONS);
    expect(res.nextSteps.join(' ')).toMatch(/put these questions to the user/i);
  });
});
