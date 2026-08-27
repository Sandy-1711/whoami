// One turn at a time, held as a list of exchanges the transcript redraws.
//
// The stream arrives as fine-grained chunks; each one patches the turn it
// belongs to rather than appending a new bubble, so text, reasoning, tool calls
// and progress all accumulate under the message that caused them.
import { useCallback, useRef, useState } from 'react';
import { answerAsk, answerConfirm, getThread, streamChat } from './api';
import type { Artifact, ChatEvent, ConfirmView, QuestionView, TurnUsage } from '../shared/events';

export interface ToolRun {
  id: string;
  name: string;
  args: unknown;
  ms?: number;
  isError?: boolean;
}

export interface Turn {
  id: string;
  question: string;
  answer: string;
  reasoning: string;
  tools: ToolRun[];
  progress: string[];
  artifacts: Artifact[];
  usage?: TurnUsage;
  error?: string;
  running: boolean;
}

export interface ConfirmPrompt {
  id: string;
  request: ConfirmView;
}

export interface AskPrompt {
  id: string;
  questions: QuestionView[];
}

function newThreadId(): string {
  return crypto.randomUUID();
}

export function useChat() {
  const [threadId, setThreadId] = useState(newThreadId);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [confirm, setConfirm] = useState<ConfirmPrompt | null>(null);
  const [ask, setAsk] = useState<AskPrompt | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const patch = useCallback((id: string, change: (turn: Turn) => Turn) => {
    setTurns((all) => all.map((turn) => (turn.id === id ? change(turn) : turn)));
  }, []);

  const apply = useCallback((id: string, event: ChatEvent) => {
    switch (event.type) {
      case 'text':
        return patch(id, (t) => ({ ...t, answer: t.answer + event.text }));
      case 'reasoning':
        return patch(id, (t) => ({ ...t, reasoning: t.reasoning + event.text }));
      case 'progress':
        return patch(id, (t) => ({ ...t, progress: [...t.progress, event.line] }));
      case 'tool-call':
        return patch(id, (t) => ({
          ...t,
          tools: [...t.tools, { id: event.id, name: event.name, args: event.args }],
        }));
      case 'tool-result':
        return patch(id, (t) => ({
          ...t,
          tools: t.tools.map((tool) =>
            tool.id === event.id ? { ...tool, ms: event.ms, isError: event.isError } : tool),
        }));
      case 'artifact':
        return patch(id, (t) => (
          t.artifacts.some((a) => a.relPath === event.artifact.relPath)
            ? t
            : { ...t, artifacts: [...t.artifacts, event.artifact] }
        ));
      case 'confirm':
        return setConfirm({ id: event.id, request: event.request });
      case 'ask':
        return setAsk({ id: event.id, questions: event.questions });
      case 'error':
        return patch(id, (t) => ({ ...t, error: event.message }));
      case 'done':
        return patch(id, (t) => ({ ...t, usage: event.usage }));
    }
  }, [patch]);

  const send = useCallback(async (message: string) => {
    const text = message.trim();
    if (!text || running) return;

    const id = crypto.randomUUID();
    setTurns((all) => [...all, {
      id, question: text, answer: '', reasoning: '',
      tools: [], progress: [], artifacts: [], running: true,
    }]);
    setRunning(true);

    const controller = new AbortController();
    inFlight.current = controller;
    try {
      await streamChat({ message: text, threadId }, (event) => apply(id, event), controller.signal);
    } catch (err) {
      // Aborting is how Stop is spelled; it is not a failure to report.
      if (!controller.signal.aborted) patch(id, (t) => ({ ...t, error: (err as Error).message }));
    } finally {
      inFlight.current = null;
      patch(id, (t) => ({ ...t, running: false }));
      setRunning(false);
      // A finished turn may have written a file. Bumping this is what tells the
      // preview pane to re-list, so a new output appears in its picker without
      // anyone reaching for refresh.
      setCompleted((n) => n + 1);
      // Whatever was waiting on the browser died with the stream.
      setConfirm(null);
      setAsk(null);
    }
  }, [apply, patch, running, threadId]);

  const stop = useCallback(() => inFlight.current?.abort(), []);

  const resolveConfirm = useCallback(async (approved: boolean) => {
    if (!confirm) return;
    setConfirm(null);
    await answerConfirm(confirm.id, approved).catch(() => {});
  }, [confirm]);

  const resolveAsk = useCallback(async (answers: { id: string; answer: string }[]) => {
    if (!ask) return;
    setAsk(null);
    await answerAsk(ask.id, answers).catch(() => {});
  }, [ask]);

  const startThread = useCallback(() => {
    setThreadId(newThreadId());
    setTurns([]);
  }, []);

  // Reopening a past thread redraws what was said. Tool calls are not replayed:
  // the timeline is a live view of a turn, and the store keeps the outcome, not
  // the timing.
  const openThread = useCallback(async (id: string) => {
    setThreadId(id);
    const { messages } = await getThread(id);
    const restored: Turn[] = [];
    for (const message of messages) {
      if (message.role === 'user') {
        restored.push({
          id: message.id, question: message.text, answer: '', reasoning: '',
          tools: [], progress: [], artifacts: [], running: false,
        });
      } else if (restored.length) {
        const last = restored[restored.length - 1]!;
        last.answer += message.text;
      }
    }
    setTurns(restored);
  }, []);

  return {
    threadId, turns, running, completed, confirm, ask,
    send, stop, resolveConfirm, resolveAsk, startThread, openThread,
  };
}
