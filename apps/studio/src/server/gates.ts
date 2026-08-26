// The human-in-the-loop gates, wired across the wire instead of to a terminal.
//
// The shape is unchanged from the CLI's: deps.confirm gets a ConfirmRequest —
// the resolved call, not a sentence about it — and returns a boolean. Here the
// request goes out on the turn's SSE stream, the modal renders those same
// fields, and the browser's POST settles the promise.
import type { AskGate, ConfirmGate, ConfirmRequest, UserAnswer } from '@resume/agent';
import type { PendingRequests } from './pending.js';
import type { EventSink } from './sink.js';

// Long enough to read a cold email and think about it; short enough that a
// closed tab does not strand a tool call for the rest of the session.
export const CONFIRM_TIMEOUT_MS = 5 * 60_000;
export const ASK_TIMEOUT_MS = 10 * 60_000;

/**
 * A confirm gate that asks the browser. Unanswered means refused — a timeout
 * must not read as approval, and neither must a browser that went away.
 */
export function browserConfirm(pending: PendingRequests<boolean>, sink: EventSink): ConfirmGate {
  return (request: ConfirmRequest) => pending.put({
    timeoutMs: CONFIRM_TIMEOUT_MS,
    fallback: false,
    emit: (id) => sink.send({ type: 'confirm', id, request }),
  });
}

/**
 * An ask gate that puts ask_user's questions in the browser. Unanswered throws,
 * so the model is told nobody answered rather than handed blank preferences it
 * would treat as chosen.
 */
export function browserAsk(pending: PendingRequests<UserAnswer[] | null>, sink: EventSink): AskGate {
  return async (questions) => {
    const answers = await pending.put({
      timeoutMs: ASK_TIMEOUT_MS,
      fallback: null,
      emit: (id) => sink.send({ type: 'ask', id, questions }),
    });
    if (!answers) throw new Error('The questions went unanswered in the studio.');
    return answers;
  };
}
