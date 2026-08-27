// The conversation: what was asked, what the agent did about it, what came back.
import { useEffect, useRef, useState } from 'react';
import { uploadJd } from '../api';
import type { Turn } from '../useChat';
import { ArtifactCard } from './ArtifactCard';
import { Markdown } from './Markdown';
import { ToolTimeline } from './ToolTimeline';
import { Button, Panel } from './ui';

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="my-1 text-xs">
      <button type="button" onClick={() => setOpen(!open)} className="text-zinc-500 italic hover:text-zinc-300">
        {open ? '▾' : '▸'} thinking
      </button>
      {open ? <div className="mt-1"><Markdown text={text} tone="reasoning" /></div> : null}
    </div>
  );
}

function Exchange({ turn, onPreview }: { turn: Turn; onPreview: (relPath: string) => void }) {
  return (
    <article className="border-b border-zinc-900 px-4 py-3 last:border-0">
      <p className="mb-2 whitespace-pre-wrap text-zinc-400">{turn.question}</p>
      <Reasoning text={turn.reasoning} />
      <ToolTimeline tools={turn.tools} progress={turn.progress} />
      <Markdown text={turn.answer} />
      {turn.artifacts.map((artifact) => (
        <ArtifactCard key={artifact.relPath} artifact={artifact} onPreview={onPreview} />
      ))}
      {turn.running && !turn.answer ? <p className="text-sm text-zinc-600">thinking…</p> : null}
      {turn.error ? (
        <p className="mt-2 rounded border border-red-900/60 bg-red-950/40 p-2 text-xs text-red-300">{turn.error}</p>
      ) : null}
      {turn.usage && (turn.usage.inputTokens || turn.usage.outputTokens) ? (
        <p className="mt-2 text-[11px] text-zinc-600">
          ↑{turn.usage.inputTokens.toLocaleString()} ↓{turn.usage.outputTokens.toLocaleString()} tokens
        </p>
      ) : null}
    </article>
  );
}

export function ChatPane({ turns, running, onSend, onStop, onNewThread, onPreview }: {
  turns: Turn[];
  running: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
  onNewThread: () => void;
  onPreview: (relPath: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [attached, setAttached] = useState<string>('');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns]);

  const submit = (): void => {
    if (!draft.trim() || running) return;
    // A JD reaches the tools as a path, never as pasted text — every JD-taking
    // tool accepts jdPath, and the file is already on disk by now.
    onSend(attached ? `${draft}\n\nThe job description is at: ${attached}` : draft);
    setDraft('');
    setAttached('');
  };

  const attach = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const { path } = await uploadJd(file);
    setAttached(path);
  };

  return (
    <Panel
      title="chat"
      actions={<Button onClick={onNewThread} disabled={running}>new thread</Button>}
      bodyClass="flex flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {turns.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-600">
            Ask for a fit score, a tailored résumé, a note for a company. Attach a JD and it is handed
            over as a path.
          </p>
        ) : turns.map((turn) => <Exchange key={turn.id} turn={turn} onPreview={onPreview} />)}
        <div ref={bottom} />
      </div>

      <div className="shrink-0 border-t border-zinc-800 p-2">
        {attached ? (
          <p className="mb-1 truncate text-[11px] text-zinc-500">attached: {attached}</p>
        ) : null}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          rows={3}
          placeholder="Enter to send, Shift+Enter for a newline"
          className="w-full resize-none rounded border border-zinc-800 bg-zinc-950 p-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          <label className="cursor-pointer rounded border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800">
            attach JD
            <input
              type="file"
              accept=".txt,.md,text/*"
              className="hidden"
              onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ''; }}
            />
          </label>
          <div className="flex-1" />
          {running
            ? <Button tone="stop" onClick={onStop}>stop</Button>
            : <Button tone="go" onClick={submit} disabled={!draft.trim()}>send</Button>}
        </div>
      </div>
    </Panel>
  );
}
