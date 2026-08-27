// Past conversations, out of the same libSQL store `resume chat` resumes from —
// a thread started in the terminal opens here and the other way round.
import { useEffect, useState } from 'react';
import { deleteThread, getThreads } from '../api';
import type { ThreadSummary } from '../../shared/events';
import { Button, Panel } from './ui';

export function ThreadList({ current, version, onOpen, onDeleted }: {
  current: string;
  /** Bumped when a turn ends, so a new thread and its new title appear on their own. */
  version: number;
  onOpen: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  // Deleting takes the messages with it and cannot be undone, so the × arms and
  // the second click is the one that means it. Only one row is ever armed.
  const [armed, setArmed] = useState<string | null>(null);
  const [problem, setProblem] = useState('');

  const load = (): void => {
    getThreads().then((r) => setThreads(r.threads)).catch(() => setThreads([]));
  };
  useEffect(load, [version]);

  const remove = async (id: string): Promise<void> => {
    if (armed !== id) { setArmed(id); return; }
    setArmed(null);
    setProblem('');
    try {
      await deleteThread(id);
      onDeleted(id);
      load();
    } catch (err) {
      setProblem((err as Error).message);
    }
  };

  return (
    <Panel title="threads" actions={<Button onClick={load}>refresh</Button>} bodyClass="overflow-y-auto">
      {problem ? <p className="px-3 py-1.5 text-[11px] text-red-300">{problem}</p> : null}
      {threads.length === 0 ? (
        <p className="p-3 text-xs text-zinc-600">Nothing yet — the first turn starts one.</p>
      ) : (
        <ul>
          {threads.map((thread) => (
            <li key={thread.id} className="flex items-center gap-1 pr-2 hover:bg-zinc-800/60">
              <button
                type="button"
                onClick={() => onOpen(thread.id)}
                className={`min-w-0 flex-1 truncate px-3 py-1.5 text-left text-xs ${
                  thread.id === current ? 'text-emerald-300' : 'text-zinc-400'
                }`}
              >
                {thread.title}
              </button>
              <button
                type="button"
                onClick={() => { void remove(thread.id); }}
                onBlur={() => setArmed((id) => (id === thread.id ? null : id))}
                title="delete this thread"
                className={`shrink-0 text-[10px] ${
                  armed === thread.id ? 'text-red-300' : 'text-zinc-600 hover:text-red-300'
                }`}
              >
                {armed === thread.id ? 'delete?' : '×'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
