// Translating one agent stream into browser events.
//
// Split out of turn.ts so it can be driven by hand: everything here is a pure
// function of the chunks the agent produced, and the alternative to testing it
// is spending a real turn to find out whether a payload field is named what we
// think it is.
import type { EventSink } from './sink.js';
import type { TurnUsage } from '../shared/events.js';
import { artifactsFrom } from './artifacts.js';

/** A chunk of `agent.stream(...).fullStream`, read by key rather than by type. */
export interface StreamChunk {
  type: string;
  payload: any;
}

/** Told about each call as it starts, for anything downstream of the browser. */
export type CallWatcher = (name: string, args: unknown) => void;

/** Relay one agent stream to the browser. Returns the turn's aggregate usage. */
export async function relay(
  chunks: AsyncIterable<StreamChunk>,
  sink: EventSink,
  onCall: CallWatcher = () => {},
): Promise<TurnUsage> {
  const usage: TurnUsage = { inputTokens: 0, outputTokens: 0 };
  // tool-call → tool-result elapsed time, keyed by call id (name as fallback).
  const started = new Map<string, number>();

  for await (const chunk of chunks) {
    switch (chunk.type) {
      case 'reasoning-delta': {
        const text: string = chunk.payload?.text ?? '';
        if (text) sink.send({ type: 'reasoning', text });
        break;
      }
      case 'text-delta':
        sink.send({ type: 'text', text: chunk.payload.text });
        break;
      case 'tool-call': {
        const id: string = chunk.payload.toolCallId ?? chunk.payload.toolName;
        started.set(id, Date.now());
        sink.send({ type: 'tool-call', id, name: chunk.payload.toolName, args: chunk.payload.args });
        onCall(chunk.payload.toolName, chunk.payload.args);
        break;
      }
      case 'tool-result': {
        const id: string = chunk.payload.toolCallId ?? chunk.payload.toolName;
        const began = started.get(id);
        sink.send({
          type: 'tool-result',
          id,
          name: chunk.payload.toolName,
          isError: Boolean(chunk.payload.isError),
          ms: began ? Date.now() - began : 0,
        });
        // The result itself stays on this side — only the files it named cross
        // the wire, so a large payload never lands in the transcript.
        for (const artifact of artifactsFrom(chunk.payload.toolName, chunk.payload.result)) {
          sink.send({ type: 'artifact', id, artifact });
        }
        break;
      }
      case 'finish': {
        // FinishPayload.output.usage carries the turn's aggregate token counts.
        const u = chunk.payload?.output?.usage;
        if (u) {
          usage.inputTokens = u.inputTokens ?? 0;
          usage.outputTokens = u.outputTokens ?? 0;
        }
        break;
      }
      case 'error':
        sink.send({
          type: 'error',
          message: String(chunk.payload?.error?.message ?? chunk.payload?.error ?? chunk.payload),
        });
        break;
    }
  }

  return usage;
}
