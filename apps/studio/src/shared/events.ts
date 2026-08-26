// The wire format between the studio server and its SPA. One module, so a route
// and the component reading it cannot drift apart.
//
// The two halves resolve modules differently, so they spell the import
// differently: the server is NodeNext and writes '../shared/events.js', the SPA
// is bundler-resolved and writes '../shared/events'. Same file.

/** Token counts for one turn, as the provider reported them. */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
}

/** A confirm request as the browser receives it — the resolved call, not a sentence about it. */
export interface ConfirmView {
  tool: string;
  action: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  preview?: string;
}

/** One question `ask_user` put to the operator. */
export interface QuestionView {
  id: string;
  question: string;
  options?: string[];
  why?: string;
}

/**
 * A chunk of one chat turn. Sent as `event: <type>` with the whole object as the
 * SSE data payload. The set mirrors what the chat REPL renders, plus the two
 * events that only exist because there is a browser to answer them.
 */
export type ChatEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string }
  | { type: 'progress'; line: string }
  | { type: 'tool-call'; id: string; name: string; args: unknown }
  | { type: 'tool-result'; id: string; name: string; isError: boolean; ms: number }
  | { type: 'confirm'; id: string; request: ConfirmView }
  | { type: 'ask'; id: string; questions: QuestionView[] }
  | { type: 'error'; message: string }
  | { type: 'done'; threadId: string; usage: TurnUsage };

/** A past conversation, as `GET /api/threads` lists them. */
export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** One stored message, flattened to what the transcript needs to redraw it. */
export interface ThreadMessage {
  id: string;
  role: string;
  text: string;
  createdAt: string;
}

/** A tailored PDF on disk, as `GET /api/outputs` lists them. */
export interface OutputFile {
  relPath: string;
  mtime: string;
}
