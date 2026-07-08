// Width checker: parse a LaTeX .log for horizontal-overflow warnings.
//
// When a line of content runs past the text width, LaTeX (via latexmk) prints
//   Overfull \hbox (33.48pt too wide) in paragraph at lines 120--124
// to both stdout and the .log file. The page-count check in check-resume.js
// catches vertical overflow (a spilled page); this catches the horizontal kind,
// which does NOT add a page and so slips past a page-count-only gate.
//
// Sub-point overflows are visually invisible (and common with justified text),
// so only overflows wider than `maxOverfullPt` are reported.
import { readFile } from 'node:fs/promises';

export async function checkLog(logPath, { maxOverfullPt = 2 } = {}) {
  let raw;
  try {
    // LaTeX logs are latin1-ish and not guaranteed valid UTF-8.
    raw = await readFile(logPath, 'latin1');
  } catch (err) {
    return [`Could not read LaTeX log at ${logPath}: ${err.message}`];
  }

  const problems = [];
  const re = /Overfull \\hbox \((\d+(?:\.\d+)?)pt too wide\)([^\n]*)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const pt = parseFloat(m[1]);
    if (pt > maxOverfullPt) {
      const where = m[2].replace(/\s+/g, ' ').trim();
      problems.push(
        `Content runs ${pt}pt past the page width${where ? ` (${where})` : ''} — a line is too long and spills off the right edge.`,
      );
    }
  }
  return problems;
}
