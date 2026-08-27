// The handful of shapes every pane is built out of. Kept here so the feature
// components stay about their feature and not about border colours.
import type { ReactNode } from 'react';

export function Panel({ title, actions, children, bodyClass = '' }: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyClass?: string;
}) {
  // min-w-0 is load-bearing: a grid item defaults to min-width:auto and refuses
  // to shrink below its content, so without it a wide pane spills over its
  // neighbours instead of scrolling inside its own track.
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
        <h2 className="truncate text-xs font-semibold tracking-wide text-zinc-400 uppercase">{title}</h2>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>
      <div className={`min-h-0 min-w-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

const TONE = {
  plain: 'border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-800',
  go: 'border-emerald-700/60 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/70',
  stop: 'border-red-800/60 bg-red-950/40 text-red-200 hover:bg-red-950/70',
} as const;

export function Button({ tone = 'plain', children, ...rest }: {
  tone?: keyof typeof TONE;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`rounded border px-2 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${TONE[tone]}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Green when ready, red when it will fail, amber when it only might. */
export function Dot({ state }: { state: 'ok' | 'bad' | 'maybe' }) {
  const colour = state === 'ok' ? 'bg-emerald-400' : state === 'bad' ? 'bg-red-400' : 'bg-amber-400';
  return <span className={`inline-block size-1.5 shrink-0 rounded-full ${colour}`} />;
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className="min-w-0 truncate text-right text-zinc-300">{children}</span>
    </div>
  );
}

export function Modal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-6">
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <header className="shrink-0 border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        </header>
        {children}
      </div>
    </div>
  );
}
