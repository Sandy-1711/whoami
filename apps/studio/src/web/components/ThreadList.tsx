// Past conversations, out of the same libSQL store `resume chat` resumes from —
// a thread started in the terminal opens here and the other way round.
import { useEffect, useState } from 'react';
import { getThreads } from '../api';
import type { ThreadSummary } from '../../shared/events';
import { Button, Panel } from './ui';

export function ThreadList({ current, onOpen }: {
  current: string;
  onOpen: (id: string) => void;
}) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);

  const load = (): void => {
    getThreads().then((r) => setThreads(r.threads)).catch(() => setThreads([]));
  };
  useEffect(load, []);

  return (
    <Panel title="threads" actions={<Button onClick={load}>refresh</Button>} bodyClass="overflow-y-auto">
      {threads.length === 0 ? (
        <p className="p-3 text-xs text-zinc-600">Nothing yet — the first turn starts one.</p>
      ) : (
        <ul>
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => onOpen(thread.id)}
                className={`w-full truncate px-3 py-1.5 text-left text-xs hover:bg-zinc-800/60 ${
                  thread.id === current ? 'text-emerald-300' : 'text-zinc-400'
                }`}
              >
                {thread.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
