// Requests the server puts to the browser mid-turn and blocks on: a confirm
// gate, a question from ask_user. The caller parks a promise here, the id goes
// out on the SSE stream, and the browser's POST settles it.
//
// Every path out of the map resolves. A gate that hangs is worse than one that
// refuses — it holds a tool call open forever, and the browser that was supposed
// to answer may already be gone.
import { randomUUID } from 'node:crypto';

export interface PendingOptions<T> {
  /** How long to wait for an answer before settling with `fallback`. */
  timeoutMs: number;
  /** What an unanswered request resolves to. For a confirm gate: refusal. */
  fallback: T;
  /** Put the id on the wire. Throwing here settles the request immediately. */
  emit: (id: string) => void;
}

export class PendingRequests<T> {
  private readonly waiting = new Map<string, (value: T) => void>();

  /** Requests still open — what `abandon` would settle. */
  get outstanding(): number {
    return this.waiting.size;
  }

  /** Park a request under a fresh id and return the promise the gate awaits. */
  put(options: PendingOptions<T>): Promise<T> {
    const { timeoutMs, fallback, emit } = options;
    const id = randomUUID();

    const answered = new Promise<T>((resolve) => {
      const timer = setTimeout(() => this.settle(id, fallback), timeoutMs);
      // An unanswered gate must not be a reason the process stays alive.
      timer.unref?.();
      this.waiting.set(id, (value) => { clearTimeout(timer); resolve(value); });
    });

    try {
      emit(id);
    } catch {
      this.settle(id, fallback);
    }
    return answered;
  }

  /** Answer an open request. False when the id is unknown or already settled. */
  settle(id: string, value: T): boolean {
    const resolve = this.waiting.get(id);
    if (!resolve) return false;
    this.waiting.delete(id);
    resolve(value);
    return true;
  }

  /** Settle everything still open — the stream that would have shown them is gone. */
  abandon(fallback: T): void {
    for (const id of [...this.waiting.keys()]) this.settle(id, fallback);
  }
}
