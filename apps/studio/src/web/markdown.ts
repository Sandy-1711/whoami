// Markdown-lite for the transcript. The same subset the CLI's renderer handles
// — headings, bold, italics, bullets, numbers, quotes, inline code and fences —
// plus links, because this one renders into a browser.
//
// It parses to data rather than to output, so the rendering lives in
// components/Markdown.tsx and this stays testable without a DOM. The CLI's
// apps/cli/src/markdown.ts is not shared: it styles one line at a time straight
// to ANSI, while a browser needs blocks grouped before anything can be drawn.
//
// Everything here must survive a half-arrived document: text streams in token by
// token, so an unclosed fence is a code block that has not ended yet, and an
// unpaired `**` is literal text until its partner shows up.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'paragraph'; lines: string[] };

// One alternation so the first match wins by position, which is what keeps
// bold from being eaten by the single-asterisk italic rule and stops either
// rewriting the inside of a code span.
const INLINE =
  /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]*)\]\(([^)\s]+)\)|(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])|(?<!\w)_([^_\s][^_]*)_(?!\w)/g;

// A link the browser will follow. Anything else keeps its label and loses the
// href — a transcript is model output, and `javascript:` has no business here.
function safeHref(href: string): string | null {
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (href.startsWith('/') || href.startsWith('./') || href.startsWith('#')) return href;
  return null;
}

/** Split one line of prose into its styled runs. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;

  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(line); m; m = INLINE.exec(line)) {
    if (m.index > last) out.push({ kind: 'text', text: line.slice(last, m.index) });
    const [, code, bold, label, href, star, underscore] = m;

    if (code !== undefined) out.push({ kind: 'code', text: code });
    else if (bold !== undefined) out.push({ kind: 'bold', text: bold });
    else if (href !== undefined) {
      const url = safeHref(href);
      const text = label || href;
      out.push(url ? { kind: 'link', text, href: url } : { kind: 'text', text });
    } else out.push({ kind: 'italic', text: (star ?? underscore)! });

    last = m.index + m[0].length;
  }

  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
  return out;
}

const FENCE = /^\s*```(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

/**
 * Group a markdown document into blocks.
 *
 * A fence with no closing fence yields a code block all the same — mid-stream
 * that is exactly what has been said so far, and closing it later grows the same
 * block rather than replacing it.
 */
export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: 'code', lang: fence[1]!.trim(), text: body.join('\n') });
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! });
      i += 1;
      continue;
    }

    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      const pattern = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      while (i < lines.length) {
        const item = pattern.exec(lines[i]!);
        if (!item) break;
        items.push(item[1]!);
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const quote = QUOTE.exec(lines[i]!);
        if (!quote) break;
        quoted.push(quote[1]!);
        i += 1;
      }
      blocks.push({ kind: 'quote', lines: quoted });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = lines[i]!;
      if (!next.trim() || FENCE.test(next) || HEADING.test(next) || BULLET.test(next)
        || NUMBERED.test(next) || QUOTE.test(next)) break;
      paragraph.push(next);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }

  return blocks;
}
