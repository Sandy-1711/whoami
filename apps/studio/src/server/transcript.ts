// Reading a stored message back into what the transcript draws.
//
// Split out for the same reason relay.ts was: the shapes are Mastra's, they are
// read by key, and the alternative to testing them by hand is spending a turn to
// find out whether a part is still spelled the way this file assumes.
//
// A stored assistant message carries the whole turn as an ordered list of parts
// — text, reasoning, and one `tool-invocation` per call with its arguments and
// its result. What it does not carry is wall-clock time: that is measured live
// in relay.ts and is gone by the time a thread is reopened, so a restored call
// crosses the wire without a duration rather than with an invented one.
import { artifactsFrom } from './artifacts.js';
import type { Artifact, StoredCall, ThreadMessage } from '../shared/events.js';

/** A message as `memory.recall` returns it, read by key like the stream chunks. */
export interface StoredMessage {
  id: string;
  role: string;
  createdAt: Date | string;
  content?: { parts?: unknown };
}

interface Part {
  type?: string;
  text?: unknown;
  reasoning?: unknown;
  toolInvocation?: { toolCallId?: unknown; toolName?: unknown; args?: unknown; result?: unknown };
}

/** Flatten one stored message to the text, thinking and calls it holds. */
export function restoreMessage(message: StoredMessage): ThreadMessage {
  const parts: Part[] = Array.isArray(message.content?.parts) ? message.content.parts : [];
  const text: string[] = [];
  const reasoning: string[] = [];
  const calls: StoredCall[] = [];
  const artifacts: Artifact[] = [];

  for (const part of parts) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      text.push(part.text);
    } else if (part?.type === 'reasoning') {
      const thought = typeof part.reasoning === 'string' ? part.reasoning : part.text;
      if (typeof thought === 'string' && thought.trim()) reasoning.push(thought);
    } else if (part?.type === 'tool-invocation') {
      const call = restoreCall(part.toolInvocation);
      if (!call) continue;
      calls.push(call);
      artifacts.push(...artifactsFrom(call.name, part.toolInvocation?.result));
    }
  }

  return {
    id: message.id,
    role: message.role,
    text: text.join(''),
    // Stored thinking arrives as whole blocks rather than as deltas, so they are
    // paragraphs of one another.
    reasoning: reasoning.join('\n\n'),
    calls,
    artifacts,
    createdAt: new Date(message.createdAt).toISOString(),
  };
}

/** Whether a restored message leaves the transcript anything to draw. */
export function hasContent(message: ThreadMessage): boolean {
  return Boolean(message.text.trim() || message.reasoning.trim() || message.calls.length);
}

function restoreCall(invocation: Part['toolInvocation']): StoredCall | undefined {
  const name = invocation?.toolName;
  if (typeof name !== 'string' || !name) return undefined;
  const id = invocation?.toolCallId;
  return { id: typeof id === 'string' && id ? id : name, name, args: invocation?.args };
}
