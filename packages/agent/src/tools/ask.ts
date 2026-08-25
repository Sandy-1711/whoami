// ask_user — the model's way of getting a preference it cannot infer. Without
// it, a request like "write them a note" is answered by guessing a tone and a
// length, or by asking the user something vague in prose and hoping the answer
// comes back in a usable shape.
//
// Where a human is reachable in-process (chat) the questions are put to them and
// the answers returned. Where one is not (MCP), the client is already talking to
// the user, so the questions go back to it to ask.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { AgentDeps } from '../deps.js';

// Four is already a lot to put to someone who asked for one note.
const MAX_QUESTIONS = 4;

export function askTools(deps: AgentDeps) {
  const ask_user = createTool({
    id: 'ask_user',
    description:
      'Ask the user a small number of concrete questions and get their answers back — use this ' +
      'when a choice is genuinely theirs and you would otherwise be guessing: how formal a message ' +
      'should be, how long, which of two angles to lead with, whether to mention a referral, which ' +
      'company an ambiguous name refers to. Offer `options` when the sensible answers are ' +
      'enumerable, and say in `why` what the answer changes. Ask BEFORE spending a paid drafting ' +
      'call, not after. Do not use it for anything you can read from the fact base, the JD, or the ' +
      'files on disk, and do not use it to confirm an action — sending and pushing carry their own ' +
      'confirmation.',
    inputSchema: z.object({
      questions: z.array(z.object({
        id: z.string().describe('Short stable key the answer comes back under, e.g. "tone".'),
        question: z.string().describe('The question, as you would put it to a person.'),
        options: z.array(z.string()).optional().describe('Suggested answers; the user can still say something else.'),
        why: z.string().optional().describe('What their answer changes about the output.'),
      })).min(1).max(MAX_QUESTIONS).describe(`Up to ${MAX_QUESTIONS} questions. Ask only what you actually need.`),
    }),
    execute: async ({ questions }) => {
      if (!deps.ask) {
        return {
          answered: false,
          questions,
          nextSteps: [
            'No interactive channel here — put these questions to the user yourself.',
            'Then call the tool you needed them for, with their answers as its arguments.',
          ],
        };
      }
      const answers = await deps.ask(questions);
      return { answered: true, answers };
    },
  });

  return { ask_user };
}
