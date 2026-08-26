// Restricted markup — the only formatting résumé prose may carry, so nothing
// that writes copy ever writes LaTeX. Three markers:
//
//   **bold**        → \textbf{…}
//   [label](url)    → \href{url}{\underline{label}}
//   `code`          → \texttt{…}
//
// Everything else is literal. Markers are consumed first and their contents
// escaped, so a stray & or % in generated copy cannot break the compile, and a
// model that emits LaTeX anyway gets its backslashes printed, not obeyed.
import { latexEscape } from '../tailor/core.js';

// One pass over the three markers. A link label may itself contain a bracketed
// phrase — the résumé links a literal "[PR list]" — hence the inner alternative.
const MARKER = /\[((?:[^[\]\n]|\[[^\]\n]*\])+)\]\(([^)\s]+)\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;

const BOLD = /\*\*([^*\n]+)\*\*/g;

// Characters a writer reaches for that pdflatex cannot set, mapped to their TeX
// spellings. Applied before escaping — every replacement is plain ASCII that
// latexEscape leaves alone.
const TYPOGRAPHY: [RegExp, string][] = [
  [/—/g, '---'],
  [/–/g, '--'],
  [/…/g, '...'],
  [/“/g, '``'],
  [/”/g, "''"],
  [/[‘’]/g, "'"],
];

function escapeText(text: string): string {
  let out = text;
  for (const [pattern, tex] of TYPOGRAPHY) out = out.replace(pattern, tex);
  return latexEscape(out);
}

// Inside \href the argument is read before the escapes above would apply, and a
// % or # there breaks the parse.
function escapeUrl(url: string): string {
  return url.replace(/([%#\\{}])/g, '\\$1');
}

/** A hyperlink in the résumé's house style: underlined label, escaped target. */
export function latexLink(label: string, url: string): string {
  return `\\href{${escapeUrl(url)}}{\\underline{${escapeText(label)}}}`;
}

/** Prose with restricted markup → LaTeX. Everything outside a marker is escaped. */
export function markupToLatex(text: string): string {
  let out = '';
  let index = 0;
  for (const match of text.matchAll(MARKER)) {
    const [whole, label, url, code, bold] = match;
    out += escapeText(text.slice(index, match.index));
    if (url !== undefined) out += latexLink(label!, url);
    else if (code !== undefined) out += `\\texttt{${escapeText(code)}}`;
    else out += `\\textbf{${escapeText(bold!)}}`;
    index = match.index + whole.length;
  }
  return out + escapeText(text.slice(index));
}

/** Prose with restricted markup → plain text: markers dropped, link labels kept. */
export function markupToPlainText(text: string): string {
  return text.replace(MARKER, (_whole, label, _url, code, bold) => label ?? code ?? bold);
}

/** The terms a piece of prose bolds, in order of appearance. */
export function boldTerms(text: string): string[] {
  return [...text.matchAll(BOLD)].map((m) => m[1]!);
}
