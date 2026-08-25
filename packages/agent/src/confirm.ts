// The human-in-the-loop confirmation gate. Any tool that spends API credits, or
// does something irreversible or outward-facing (send an email, push to GitHub,
// overwrite the published PDF, edit the fact base) calls deps.confirm and
// proceeds only on `true`. The CLI wires a real terminal prompt; the model has no
// way to answer for the user.
//
// A request carries the values the call will actually act on, not a sentence
// about them: the recipient, the subject, the bytes that go out, the field
// changing from what to what. Approving is only meaningful if those are on
// screen, and they have to be read off the resolved call — a description the
// model wrote is not evidence of what the tool will do.
export interface ConfirmRequest {
  /** Tool id — the user is approving one specific call. */
  tool: string;
  /** What running it will do, in one line. */
  action: string;
  /** The resolved values it will act on. Empty ones are dropped. */
  params?: Record<string, string | number | boolean | null | undefined>;
  /** The exact text that will be sent, written or published, when there is one. */
  preview?: string;
}

export type ConfirmGate = (request: ConfirmRequest) => Promise<boolean>;

// A gate that always refuses — the safe default for non-interactive contexts and
// tests, so a missing wiring can never silently auto-approve a send.
export const denyGate: ConfirmGate = async () => false;

// A gate that always approves — ONLY for tests that intentionally exercise the
// post-confirmation path, and for MCP, where the client prompts the user itself.
export const allowGate: ConfirmGate = async () => true;

const PREVIEW_LINES = 30;

/** Render a confirm request as plain aligned lines, for a terminal or a log. */
export function formatConfirm({ tool, action, params, preview }: ConfirmRequest): string {
  const entries = Object.entries(params ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '');
  const width = Math.max(0, ...entries.map(([k]) => k.length));
  const lines = [`${tool} — ${action}`];
  for (const [key, value] of entries) lines.push(`    ${key.padEnd(width)}  ${value}`);

  const body = preview?.trim();
  if (body) {
    const all = body.split('\n');
    const shown = all.slice(0, PREVIEW_LINES);
    lines.push('', ...shown.map((l) => `    │ ${l}`));
    if (all.length > shown.length) lines.push(`    │ … ${all.length - shown.length} more line(s)`);
  }
  return lines.join('\n');
}

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
