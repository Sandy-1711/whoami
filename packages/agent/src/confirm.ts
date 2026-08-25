// The human-in-the-loop confirmation gate. Any tool that does something
// irreversible or outward-facing (send an email, push to GitHub, edit identity
// facts) calls deps.confirm(question) and proceeds only on `true`. The CLI wires
// a real terminal prompt; the model has no way to answer on the user's behalf.
export type ConfirmGate = (question: string) => Promise<boolean>;

// A gate that always refuses — the safe default for non-interactive contexts and
// tests, so a missing wiring can never silently auto-approve a send.
export const denyGate: ConfirmGate = async () => false;

// A gate that always approves — ONLY for tests that intentionally exercise the
// post-confirmation path. Never use in production wiring.
export const allowGate: ConfirmGate = async () => true;

export interface UserQuestion {
  /** Stable key the answer comes back under. */
  id: string;
  question: string;
  /** Suggested answers. The user may always type something else. */
  options?: string[];
  /** What the answer changes, so the question is worth being asked. */
  why?: string;
}

export interface UserAnswer {
  id: string;
  answer: string;
}

/**
 * Put concrete questions to the user and return their answers. Only front ends
 * with a human on the other end wire this; where it is absent (MCP), the tool
 * hands the questions back for the client to ask.
 */
export type AskGate = (questions: UserQuestion[]) => Promise<UserAnswer[]>;
