// Markdown-lite for the streaming chat: the model emits **bold**, ## headers,
// bullets, and code fences, and without this they print as literal symbols —
// the single biggest reason the chat read as a wall of plain text. This is a
// line-buffered ANSI styler, not a markdown parser: tokens stream in, complete
// lines render styled, and a flush handles the partial tail. picocolors only.
import { pc } from './ui.js';

export interface StreamRenderer {
  push(text: string): void;
  flush(): void;
}

interface FenceState { inFence: boolean }

// Inline transforms: `code` → yellow, **bold** → bold, *i*/_i_ → italic.
// Code spans are split out first so bold/italic never rewrite inside them;
// bold runs before italic so `**` pairs aren't eaten by the single-`*` rule.
export function styleInline(line: string): string {
  return line
    .split(/(`[^`]+`)/g)
    .map((seg) => {
      if (seg.length > 2 && seg.startsWith('`') && seg.endsWith('`')) {
        return pc.yellow(seg.slice(1, -1));
      }
      return seg
        .replace(/\*\*([^*]+)\*\*/g, (_, t: string) => pc.bold(t))
        .replace(/(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])/g, (_, t: string) => pc.italic(t))
        .replace(/(?<!\w)_([^_\s][^_]*)_(?!\w)/g, (_, t: string) => pc.italic(t));
    })
    .join('');
}

// Style one complete line. Fence lines toggle a dim raw mode where no inline
// transforms run (code must print verbatim).
export function styleLine(line: string, state: FenceState): string {
  if (/^\s*```/.test(line)) {
    state.inFence = !state.inFence;
    return pc.dim(line);
  }
  if (state.inFence) return pc.dim(line);

  const h = /^(#{1,6})\s+(.*)$/.exec(line);
  if (h) return pc.bold(pc.cyan(h[2]!));

  const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
  if (bullet) return `${bullet[1]}${pc.cyan('•')} ${styleInline(bullet[2]!)}`;

  const num = /^(\s*)(\d+[.)])\s+(.*)$/.exec(line);
  if (num) return `${num[1]}${pc.cyan(num[2]!)} ${styleInline(num[3]!)}`;

  const quote = /^>\s?(.*)$/.exec(line);
  if (quote) return pc.dim(pc.italic(`│ ${quote[1]}`));

  return styleInline(line);
}

// If a single line grows past this with no newline, give up buffering and pass
// it through raw — never hold a runaway line hostage.
const MAX_BUFFER = 2000;

export interface StreamRendererOptions {
  // Force plain passthrough (default: RESUME_PLAIN env or a non-TTY stdout).
  plain?: boolean;
}

export function createStreamRenderer(
  write: (s: string) => void,
  opts: StreamRendererOptions = {},
): StreamRenderer {
  const plain = opts.plain ?? (Boolean(process.env.RESUME_PLAIN) || !process.stdout.isTTY);
  if (plain) {
    return { push: (t) => { if (t) write(t); }, flush: () => {} };
  }

  let buf = '';
  const state: FenceState = { inFence: false };

  return {
    push(text: string) {
      if (!text) return;
      buf += text;
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        write(styleLine(line, state) + '\n');
      }
      if (buf.length > MAX_BUFFER) {
        write(buf);
        buf = '';
      }
    },
    // Emit the partial tail (inline styling only — the line may still grow, but
    // a flush means something else is about to print, so render what we have).
    flush() {
      if (!buf) return;
      write(state.inFence ? pc.dim(buf) : styleInline(buf));
      buf = '';
    },
  };
}
