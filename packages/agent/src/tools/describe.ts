// One shape for every tool description.
//
// A caller — especially an MCP client that sees the tool list and nothing else —
// picks a tool by reading descriptions side by side. Prose blobs make that a
// comparison of paragraphs; a fixed set of labelled lines makes it a comparison
// of the same four facts: what it does, what it costs, when it is the wrong
// choice, and what usually follows it.
//
// The cost line matters most in this repo. Some of these tools spend real API
// credits and some are free, and nothing in a tool's name says which.

export type ToolCost =
  | 'free'      // no model, no network
  | 'network'   // no model, but it goes out to the internet
  | 'local'     // no model, but it writes files or runs the toolchain
  | 'llm'       // spends API credits
  | 'outward';  // leaves this machine — mail sent, GitHub written

const COST_LINE: Record<ToolCost, string> = {
  free: 'COST: free — no model call, no network.',
  network: 'COST: free of model spend; makes a network request.',
  local: 'COST: free of model spend; writes locally.',
  llm: 'COST: SPENDS LLM CREDITS.',
  outward: 'COST: SPENDS LLM CREDITS and acts outside this machine — not reversible.',
};

export interface ToolDoc {
  /** What it does, in one or two sentences. */
  does: string;
  cost: ToolCost;
  /** The situation this tool is the right answer to. */
  use: string;
  /** When it is the wrong choice — name the tool that is right instead. */
  avoid?: string;
  /** Preconditions: a key, a running daemon, a prior call. */
  needs?: string;
  /** What normally follows a successful call. */
  then?: string;
}

/**
 * The argument an outward-facing tool requires before it will act. It is not the
 * human gate — deps.confirm is — but a second, in-band signal: the intent to
 * send or publish appears in the tool call itself, where an MCP client renders
 * it for the user, and a half-formed call cannot reach the network by accident.
 */
export const CONFIRM_ARG =
  'Must be true, and only after the user has SEEN what this will do and asked for it. ' +
  'Setting it yourself to get past this is a serious error.';

/** Render a tool description in the shape every tool in this package uses. */
export function describeTool(doc: ToolDoc): string {
  const lines = [doc.does.trim(), COST_LINE[doc.cost], `USE WHEN: ${doc.use}`];
  if (doc.avoid) lines.push(`NOT FOR: ${doc.avoid}`);
  if (doc.needs) lines.push(`NEEDS: ${doc.needs}`);
  if (doc.then) lines.push(`THEN: ${doc.then}`);
  return lines.join('\n');
}
