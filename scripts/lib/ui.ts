// Presentation layer for the résumé CLI. Core stack: @clack/prompts (spinner +
// prompts) and picocolors (colour). Kept for the rich bits: gradient-string (the
// brand banner) and cli-table3 (the ATS score table).
import pc from 'picocolors';
import gradient from 'gradient-string';
import Table from 'cli-table3';
import { spinner as clackSpinner } from '@clack/prompts';

export { pc };

const brand = gradient(['#8b5cf6', '#06b6d4']); // violet → cyan

// Status glyphs (replacing log-symbols) — picocolors-painted unicode.
const sym = {
  success: pc.green('✔'),
  warning: pc.yellow('⚠'),
  error: pc.red('✖'),
  info: pc.cyan('ℹ'),
};

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

// Brand-gradient a short string (used for the CLI intro line).
export const gradientText = (s: string): string => brand(s);

// Big gradient title inside a rounded box (replacing boxen).
export function banner(title: string, subtitle = ''): string {
  const inner = brand.multiline(pc.bold(title)) + (subtitle ? '\n' + pc.dim(subtitle) : '');
  return '\n' + roundBox(inner);
}

// A rounded, cyan-bordered box around multi-line content, padded 2 cols each side.
function roundBox(content: string): string {
  const lines = content.split('\n');
  const width = Math.max(...lines.map((l) => stripAnsi(l).length));
  const pad = 2;
  const border = pc.cyan;
  const top = border('╭' + '─'.repeat(width + pad * 2) + '╮');
  const bottom = border('╰' + '─'.repeat(width + pad * 2) + '╯');
  const body = lines.map((l) => {
    const trailing = ' '.repeat(width - stripAnsi(l).length);
    return border('│') + ' '.repeat(pad) + l + trailing + ' '.repeat(pad) + border('│');
  });
  return [top, ...body, bottom].join('\n');
}

type Paint = (s: string | number) => string;

function band(score: number): Paint {
  if (score >= 92) return (s) => pc.greenBright(String(s));
  if (score >= 80) return (s) => pc.green(String(s));
  if (score >= 65) return (s) => pc.yellow(String(s));
  return (s) => pc.red(String(s));
}

export function gauge(label: string, score: number, max = 100, width = 28): string {
  const pct = Math.max(0, Math.min(1, score / max));
  const filled = Math.round(pct * width);
  const paint = band(score);
  const bar = paint('█'.repeat(filled)) + pc.gray('░'.repeat(width - filled));
  return `${label.padEnd(15)} ${bar}  ${pc.bold(paint(score))}${pc.dim('/' + max)}`;
}

// Before → after score comparison as a table.
export function scoreTable(before: number, after: number, target = 92): string {
  const t = new Table({
    head: [pc.dim('metric'), pc.dim('before'), pc.dim('after'), pc.dim('target')],
    style: { head: [], border: ['gray'] },
  });
  const arrow = after > before ? pc.greenBright(`▲ +${after - before}`) : pc.dim('—');
  t.push([
    'ATS score',
    band(before)(before),
    `${pc.bold(band(after)(after))}  ${arrow}`,
    band(target)(target + '+'),
  ]);
  return t.toString();
}

export function chips(terms: string[], kind: 'good' | 'add' | 'bad' = 'good'): string {
  if (!terms.length) return pc.dim('  (none)');
  const paint: Paint =
    kind === 'good' ? (s) => pc.bgGreen(pc.black(` ${s} `))
    : kind === 'add' ? (s) => pc.bgCyan(pc.black(` ${s} `))
    : (s) => pc.bgRed(pc.white(` ${s} `));
  const width = 84;
  const lines: string[] = [];
  let line = '  ';
  for (const term of terms) {
    const chip = paint(term) + ' ';
    // strip ANSI for width math
    const vis = stripAnsi(line + chip);
    if (vis.length > width) { lines.push(line); line = '  '; }
    line += chip;
  }
  if (line.trim()) lines.push(line);
  return lines.join('\n');
}

export function heading(s: string): string {
  return '\n' + pc.bold(pc.cyan('▸ ' + s));
}

export function kv(label: string, value: string): string {
  return `  ${pc.dim(label.padEnd(13))} ${value}`;
}

export const ok = (s: string): string => `${sym.success} ${s}`;
export const warn = (s: string): string => `${sym.warning} ${pc.yellow(s)}`;
export const fail = (s: string): string => `${sym.error} ${pc.red(s)}`;
export const info = (s: string): string => `${sym.info} ${s}`;

// ---- spinner ---------------------------------------------------------------

// An ora-shaped adapter over the @clack/prompts spinner, so the pipeline can set
// `.text` while running and finish with succeed/fail/warn. clack's stop codes:
// 0 → green submit, 1 → red cancel, 2 → red error.
export interface Spinner {
  set text(v: string);
  succeed(msg?: string): void;
  fail(msg?: string): void;
  warn(msg?: string): void;
  stop(msg?: string): void;
}

export function spinner(initial = ''): Spinner {
  const s = clackSpinner();
  s.start(initial);
  // The installed @clack/prompts types declare stop(msg?) only, but the runtime
  // accepts a status code (0 submit / 1 cancel / 2 error) that picks the glyph.
  const stop = s.stop.bind(s) as (msg?: string, code?: number) => void;
  return {
    set text(v: string) { s.message(v); },
    succeed(msg = '') { stop(msg, 0); },
    fail(msg = '') { stop(pc.red(msg), 2); },
    warn(msg = '') { stop(pc.yellow(msg), 2); },
    stop(msg = '') { stop(msg, 0); },
  };
}
