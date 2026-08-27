// What a thread is called.
//
// A title is how a past conversation is found again, so it has to name the thing
// the conversation was about: the company, when a tool resolved one, and
// otherwise the request that opened it. Both are read off values the turn
// already has, which is why Mastra's own generateTitle is off — a model
// summarizing the opening exchange spent a call to produce "Job Search
// Assistance Overview" for the thread that tailored a résumé for a named
// company, and being the only writer of a title is also what makes renaming one
// safe.
import { AGENT_RESOURCE_ID } from './memory.js';

const MAX_TITLE = 60;

// What a company-bearing call says the thread is about. Only tools whose subject
// *is* the company are listed: list_outputs and list_applications take one as a
// filter, which says nothing about what the conversation is for.
const SUBJECT: Record<string, string> = {
  tailor_plan: 'résumé',
  tailor_render: 'résumé',
  draft_application_email: 'email',
  send_application_email: 'email',
  outreach_message: 'outreach',
  log_application: 'application',
};

/** One call a turn made, as naming reads it. */
export interface ToolCallRef {
  name: string;
  args: unknown;
}

/** The slice of the agent's memory a title needs. */
export interface ThreadStore {
  getThreadById(args: { threadId: string; resourceId?: string }):
    Promise<{ title?: string | null; metadata?: Record<string, unknown> } | null>;
  updateThread(args: { id: string; title: string; metadata: Record<string, unknown> }): Promise<unknown>;
}

/** Everything one turn contributes to what its thread is called. */
export interface TurnNaming {
  /** What the user asked, used when nothing better is known. */
  message: string;
  /** The calls the turn made, in the order it made them. */
  calls: ToolCallRef[];
}

/** The title a turn's calls justify, or undefined when none of them named a company. */
export function companyTitle(calls: ToolCallRef[]): string | undefined {
  // The last one wins: a thread that moved on to another company is about the
  // company it moved on to.
  for (const call of [...calls].reverse()) {
    const subject = SUBJECT[call.name];
    const company = subject ? (call.args as { company?: unknown } | null)?.company : undefined;
    if (typeof company === 'string' && company.trim()) return clip(`${company.trim()} — ${subject}`);
  }
  return undefined;
}

/** The opening request, as much of it as reads as a title. */
export function requestTitle(message: string): string {
  const opening = message.split('\n').find((line) => line.trim()) ?? '';
  return clip(opening.trim()) || 'untitled';
}

/**
 * Title the thread this turn belongs to.
 *
 * A company names the thread outright, over whatever was there before — the turn
 * that reaches a company is the turn that knows what the thread is for, and it
 * is not always the first. The opening request is only ever the fallback, so it
 * never overwrites a title that already says something.
 *
 * A title is not worth failing a turn over, so a store that will not take one is
 * swallowed.
 */
export async function nameThread(store: ThreadStore, threadId: string, turn: TurnNaming): Promise<void> {
  try {
    const thread = await store.getThreadById({ threadId, resourceId: AGENT_RESOURCE_ID });
    if (!thread) return;
    const title = companyTitle(turn.calls) ?? (thread.title ? undefined : requestTitle(turn.message));
    if (!title || title === thread.title) return;
    await store.updateThread({ id: threadId, title, metadata: thread.metadata ?? {} });
  } catch {
    // A thread wearing a stale title is better than a turn that died renaming it.
  }
}

function clip(text: string): string {
  if (text.length <= MAX_TITLE) return text;
  return `${text.slice(0, MAX_TITLE - 1).trimEnd()}…`;
}
