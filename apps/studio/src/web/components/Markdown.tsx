// Draws what markdown.ts parsed. Blocks are keyed by position so a growing
// document reconciles in place: the block being streamed into keeps its identity
// and React patches its text rather than remounting the transcript.
//
// Two tones, because the model writes markdown in its reasoning as well as its
// answer, and a thinking block that shouted its emphasis in the answer's colours
// would stop reading as an aside.
import { memo, useMemo, type ReactNode } from 'react';
import { parseBlocks, parseInline, type Block, type Inline } from '../markdown';

interface Tone {
  body: string;
  emphasis: string;
  code: string;
}

const TONES: Record<'answer' | 'reasoning', Tone> = {
  answer: {
    body: 'text-sm text-zinc-200',
    emphasis: 'text-zinc-100',
    code: 'bg-zinc-800/80 text-amber-200',
  },
  reasoning: {
    body: 'text-xs text-zinc-500 italic',
    emphasis: 'text-zinc-400',
    code: 'bg-zinc-800/60 text-zinc-400',
  },
};

function inline(runs: Inline[], tone: Tone): ReactNode[] {
  return runs.map((run, i) => {
    switch (run.kind) {
      case 'code':
        return (
          <code key={i} className={`rounded px-1 py-0.5 text-[0.9em] ${tone.code}`}>
            {run.text}
          </code>
        );
      case 'bold':
        return <strong key={i} className={`font-semibold ${tone.emphasis}`}>{run.text}</strong>;
      case 'italic':
        return <em key={i}>{run.text}</em>;
      case 'link':
        return (
          <a
            key={i}
            href={run.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sky-400 underline decoration-sky-800 underline-offset-2 hover:text-sky-300"
          >
            {run.text}
          </a>
        );
      default:
        return <span key={i}>{run.text}</span>;
    }
  });
}

// Lines inside one paragraph are broken where the model broke them. In a chat a
// newline is meant, and rewrapping it the way markdown would reads as a bug.
function lines(text: string[], tone: Tone): ReactNode[] {
  return text.map((line, i) => (
    <span key={i}>
      {i > 0 ? <br /> : null}
      {inline(parseInline(line), tone)}
    </span>
  ));
}

const HEADING_SIZE = ['text-base', 'text-base', 'text-sm', 'text-sm', 'text-sm', 'text-sm'];

function renderBlock(block: Block, key: number, tone: Tone): ReactNode {
  switch (block.kind) {
    case 'code':
      // overflow-x-auto is the whole point: a long line scrolls inside the pane
      // instead of widening it and pushing the grid track open.
      return (
        <pre
          key={key}
          className="my-2 max-w-full overflow-x-auto rounded border border-zinc-800 bg-zinc-950/80 p-2 text-xs not-italic"
        >
          <code className={tone.emphasis}>{block.text}</code>
        </pre>
      );
    case 'heading':
      return (
        <p
          key={key}
          className={`mt-3 mb-1 font-semibold first:mt-0 ${tone.emphasis} ${HEADING_SIZE[block.level - 1]}`}
        >
          {inline(parseInline(block.text), tone)}
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          className={`my-1.5 ml-5 space-y-0.5 ${block.ordered ? 'list-decimal' : 'list-disc'} marker:text-zinc-600`}
        >
          {block.items.map((item, i) => <li key={i}>{inline(parseInline(item), tone)}</li>)}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote key={key} className="my-2 border-l-2 border-zinc-700 pl-3 italic">
          {lines(block.lines, tone)}
        </blockquote>
      );
    default:
      return <p key={key} className="my-1.5 first:mt-0 last:mb-0">{lines(block.lines, tone)}</p>;
  }
}

/** Render an agent reply, or the thinking behind it. Safe to call on a half-arrived one. */
export const Markdown = memo(function Markdown({ text, tone = 'answer' }: {
  text: string;
  tone?: keyof typeof TONES;
}) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  if (!text.trim()) return null;
  const styles = TONES[tone];
  return (
    <div className={`min-w-0 break-words ${styles.body}`}>
      {blocks.map((block, i) => renderBlock(block, i, styles))}
    </div>
  );
});
