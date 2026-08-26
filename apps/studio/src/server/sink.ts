// The browser end of one chat turn: a fire-and-forget send that keeps order.
//
// Hono's writeSSE is async, but the callers are not — a Presenter sink and a
// stream loop both hand over events synchronously. Chaining the writes is what
// stops a progress line overtaking the text it was reporting on.
import type { SSEStreamingApi } from 'hono/streaming';
import type { ChatEvent } from '../shared/events.js';

export interface EventSink {
  send(event: ChatEvent): void;
  /** Resolves once everything sent so far has reached the wire. */
  drain(): Promise<void>;
}

export function sseSink(stream: SSEStreamingApi): EventSink {
  let writes = Promise.resolve();
  return {
    send(event) {
      writes = writes
        // A closed connection is not an error worth failing the turn over; the
        // turn is already committed and its side effects are on disk.
        .then(() => stream.writeSSE({ event: event.type, data: JSON.stringify(event) }))
        .catch(() => {});
    },
    drain: () => writes,
  };
}

/** Collects events instead of writing them. For tests, and for a turn with no listener. */
export function collectingSink(): EventSink & { events: ChatEvent[] } {
  const events: ChatEvent[] = [];
  return {
    events,
    send: (event) => { events.push(event); },
    drain: async () => {},
  };
}
