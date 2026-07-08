// Presentation layer for the tailor CLI — chalk + boxen + gradients + tables.
import chalk from 'chalk';
import boxen from 'boxen';
import gradient from 'gradient-string';
import Table from 'cli-table3';
import logSymbols from 'log-symbols';

export const sym = logSymbols;
export { chalk };

const brand = gradient(['#8b5cf6', '#06b6d4']); // violet → cyan

// Brand-gradient a short string (used for the CLI intro line).
export const gradientText = (s) => brand(s);

// Big gradient title inside a rounded box.
export function banner(title, subtitle = '') {
  const inner = brand.multiline(figletish(title)) + (subtitle ? '\n' + chalk.dim(subtitle) : '');
  return boxen(inner, {
    padding: { top: 0, bottom: 0, left: 2, right: 2 },
    borderStyle: 'round',
    borderColor: 'cyan',
    margin: { top: 1, bottom: 0, left: 0, right: 0 },
  });
}

// Lightweight "big text" without a figlet dependency: just the title, spaced.
function figletish(t) {
  return chalk.bold(t);
}

function band(score) {
  if (score >= 92) return chalk.greenBright;
  if (score >= 80) return chalk.green;
  if (score >= 65) return chalk.yellow;
  return chalk.red;
}

export function gauge(label, score, max = 100, width = 28) {
  const pct = Math.max(0, Math.min(1, score / max));
  const filled = Math.round(pct * width);
  const paint = band(score);
  const bar = paint('█'.repeat(filled)) + chalk.gray('░'.repeat(width - filled));
  return `${label.padEnd(15)} ${bar}  ${paint.bold(score)}${chalk.dim('/' + max)}`;
}

// Before → after score comparison as a table.
export function scoreTable(before, after, target = 92) {
  const t = new Table({
    head: [chalk.dim('metric'), chalk.dim('before'), chalk.dim('after'), chalk.dim('target')],
    style: { head: [], border: ['gray'] },
  });
  const arrow = after > before ? chalk.greenBright(`▲ +${after - before}`) : chalk.dim('—');
  t.push([
    'ATS score',
    band(before)(before),
    `${band(after).bold(after)}  ${arrow}`,
    band(target)(target + '+'),
  ]);
  return t.toString();
}

export function chips(terms, kind = 'good') {
  if (!terms.length) return chalk.dim('  (none)');
  const paint =
    kind === 'good' ? (s) => chalk.bgGreen.black(` ${s} `)
    : kind === 'add' ? (s) => chalk.bgCyan.black(` ${s} `)
    : (s) => chalk.bgRed.white(` ${s} `);
  const width = 84;
  const lines = [];
  let line = '  ';
  for (const term of terms) {
    const chip = paint(term) + ' ';
    // strip ANSI for width math
    const vis = (line + chip).replace(/\x1b\[[0-9;]*m/g, '');
    if (vis.length > width) { lines.push(line); line = '  '; }
    line += chip;
  }
  if (line.trim()) lines.push(line);
  return lines.join('\n');
}

export function heading(s) {
  return '\n' + chalk.bold.cyan('▸ ' + s);
}

export function kv(label, value) {
  return `  ${chalk.dim(label.padEnd(13))} ${value}`;
}

export const ok = (s) => `${sym.success} ${s}`;
export const warn = (s) => `${sym.warning} ${chalk.yellow(s)}`;
export const fail = (s) => `${sym.error} ${chalk.red(s)}`;
export const info = (s) => `${sym.info} ${s}`;
