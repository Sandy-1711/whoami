import { readFile } from 'node:fs/promises';

// Sections every version of the résumé must keep. Edit here if the résumé's
// shape changes intentionally.
export const REQUIRED_SECTIONS = ['Experience', 'Projects', 'Technical Skills', 'Education'];

// Custom list macros (defined via \newcommand in resume.tex) that must open and
// close in matching pairs.
const MACRO_PAIRS = [
  ['resumeSubHeadingListStart', 'resumeSubHeadingListEnd'],
  ['resumeItemListStart', 'resumeItemListEnd'],
];

// Drop LaTeX line comments (an unescaped %), keeping escaped \% intact, so we
// never validate commented-out code.
function stripComments(tex) {
  return tex.replace(/(^|[^\\])%.*$/gm, '$1');
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Validate the LaTeX source's structure without compiling it. Returns a list of
// human-readable problems; an empty list means the structure looks sound.
//
// @param {string} path  absolute path to resume.tex
// @returns {Promise<string[]>}
export async function checkSource(path) {
  const problems = [];
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [`Cannot read source file: ${path}`];
  }
  const tex = stripComments(raw);

  if (!/\\documentclass/.test(tex)) problems.push('Missing \\documentclass.');

  // Exactly one document environment.
  const docBegin = countOccurrences(tex, '\\begin{document}');
  const docEnd = countOccurrences(tex, '\\end{document}');
  if (docBegin !== 1 || docEnd !== 1) {
    problems.push(
      `Expected exactly one \\begin{document}/\\end{document} (found ${docBegin}/${docEnd}).`,
    );
  }

  // Every \begin{env} needs a matching \end{env}. Macro definitions contribute
  // equally to both counts, so they cancel out and don't cause false positives.
  const begins = [...tex.matchAll(/\\begin\{([^}]+)\}/g)].map((m) => m[1]);
  const ends = [...tex.matchAll(/\\end\{([^}]+)\}/g)].map((m) => m[1]);
  for (const name of new Set([...begins, ...ends])) {
    const b = begins.filter((n) => n === name).length;
    const e = ends.filter((n) => n === name).length;
    if (b !== e) problems.push(`Unbalanced environment "${name}": ${b} \\begin vs ${e} \\end.`);
  }

  // Custom list macros must be balanced too.
  for (const [start, end] of MACRO_PAIRS) {
    const s = countOccurrences(tex, '\\' + start);
    const e = countOccurrences(tex, '\\' + end);
    if (s !== e) problems.push(`Unbalanced \\${start}/\\${end}: ${s} vs ${e}.`);
  }

  // Brace balance, after neutralizing escaped braces, backslashes, and percents.
  const neutral = tex.replace(/\\[{}\\%]/g, '');
  const open = countOccurrences(neutral, '{');
  const close = countOccurrences(neutral, '}');
  if (open !== close) problems.push(`Unbalanced braces: ${open} "{" vs ${close} "}".`);

  // Required sections present.
  for (const name of REQUIRED_SECTIONS) {
    const re = new RegExp('\\\\section\\{' + escapeRegExp(name) + '\\}');
    if (!re.test(tex)) problems.push(`Missing required section: \\section{${name}}.`);
  }

  // Contact header links intact.
  if (!/\\href\{mailto:/.test(tex)) problems.push('Missing mailto link in contact header.');
  if (!/linkedin/i.test(tex)) problems.push('Missing LinkedIn link.');
  if (!/github/i.test(tex)) problems.push('Missing GitHub link.');

  // No empty bullets shipped by accident.
  if (/\\resumeItem\{\s*\}/.test(tex)) problems.push('Found an empty \\resumeItem{}.');

  return problems;
}
