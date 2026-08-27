// What the agent did during one turn, in order, with what each call cost in
// wall-clock time. The CLI prints the same two lines per call; here they stay
// on screen afterwards, which is the point of having a screen.
import { useState } from 'react';
import type { ToolRun } from '../useChat';

function args(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function Call({ run }: { run: ToolRun }) {
  const [open, setOpen] = useState(false);
  const done = run.ms !== undefined;
  const glyph = !done ? '·' : run.isError ? '✗' : '✓';
  const colour = !done ? 'text-cyan-300' : run.isError ? 'text-red-400' : 'text-emerald-400';

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-zinc-800/50"
      >
        <span className={colour}>{glyph}</span>
        <span className="font-mono text-cyan-200">{run.name}</span>
        <span className="flex-1 truncate text-zinc-600">{done ? '' : 'running…'}</span>
        {done ? <span className="text-zinc-500">{(run.ms! / 1000).toFixed(1)}s</span> : null}
      </button>
      {open ? (
        <pre className="mt-1 mb-1 overflow-x-auto rounded bg-zinc-950/70 p-2 text-[11px] text-zinc-400">
          {args(run.args)}
        </pre>
      ) : null}
    </li>
  );
}

export function ToolTimeline({ tools, progress }: { tools: ToolRun[]; progress: string[] }) {
  if (!tools.length && !progress.length) return null;
  return (
    <div className="my-2 rounded border border-zinc-800 bg-zinc-900/60 p-2 text-xs">
      <ul className="space-y-0.5">
        {tools.map((run) => <Call key={run.id} run={run} />)}
      </ul>
      {progress.length ? (
        <div className="mt-1 space-y-0.5 border-t border-zinc-800 pt-1 font-mono text-[11px] text-zinc-500">
          {progress.slice(-6).map((line, i) => <div key={i} className="truncate">{line}</div>)}
        </div>
      ) : null}
    </div>
  );
}
