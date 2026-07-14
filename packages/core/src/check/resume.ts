// checkResume — the résumé guards as one structured, reusable call. The CLI
// (check-resume.ts, the git hook, CI) and the agent's check_resume tool both run
// through here, so "what counts as passing" is defined in exactly one place.
//
// Three guards: source structure (no compile needed), rendered-PDF structure
// (page count, required sections, contact email), and width (overfull hboxes in
// the build log). Each reports a list of human-readable problems; empty = clean.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkSource, REQUIRED_SECTIONS } from './source.js';
import { extractPdf } from './pdf.js';
import { checkLog } from './log.js';

export const EXPECTED_PAGES = 1;
export const MIN_PDF_TEXT_LENGTH = 200;   // guards against an empty / image-only render
export const MAX_OVERFULL_PT = 2;         // flag lines wider than this past the margin

// Which guards to run. Omitted → run all three, silently skipping PDF/width when
// their artifacts aren't built yet. Provided → run only the `true` ones, and a
// missing artifact for an explicitly-requested guard is a failure.
export interface CheckScope {
  source?: boolean;
  pdf?: boolean;
  width?: boolean;
}

export interface GuardOutcome {
  ran: boolean;
  skipped: boolean;      // requested-or-default but the artifact was absent
  problems: string[];
}

export interface CheckResumeResult {
  source: GuardOutcome;
  pdf: GuardOutcome;
  width: GuardOutcome;
  pass: boolean;
}

export interface CheckResumeInput {
  root: string;
  // Email that must appear in the rendered PDF; defaults to the known contact.
  contactEmail?: string;
  scope?: CheckScope;
}

const CLEAN = (): GuardOutcome => ({ ran: false, skipped: false, problems: [] });

async function checkPdfStructure(pdfPath: string, contactEmail: string): Promise<string[]> {
  const problems: string[] = [];
  try {
    const { text, totalPages } = await extractPdf(pdfPath);
    if (totalPages !== EXPECTED_PAGES) problems.push(`Expected ${EXPECTED_PAGES} page(s), found ${totalPages}.`);
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length < MIN_PDF_TEXT_LENGTH) {
      problems.push(`Extracted text is suspiciously short (${compact.length} chars) — PDF may be empty or image-only.`);
    }
    for (const name of REQUIRED_SECTIONS) {
      const re = new RegExp(name.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'i');
      if (!re.test(text)) problems.push(`Section "${name}" not found in rendered PDF text.`);
    }
    if (!text.includes(contactEmail)) problems.push(`Contact email ${contactEmail} not found in rendered PDF text.`);
  } catch (err) {
    problems.push(`Failed to parse PDF: ${(err as Error).message}`);
  }
  return problems;
}

export async function checkResume(input: CheckResumeInput): Promise<CheckResumeResult> {
  const { root, contactEmail = 'sandy1711003@gmail.com', scope } = input;
  const all = !scope;
  const wantSource = all || Boolean(scope?.source);
  const wantPdf = all || Boolean(scope?.pdf);
  const wantWidth = all || Boolean(scope?.width);

  const source = CLEAN();
  const pdf = CLEAN();
  const width = CLEAN();

  if (wantSource) {
    source.ran = true;
    source.problems = await checkSource(join(root, 'resume.tex'));
  }

  const pdfPath = join(root, 'apps', 'web', 'assets', 'resume.pdf');
  if (wantPdf) {
    if (existsSync(pdfPath)) {
      pdf.ran = true;
      pdf.problems = await checkPdfStructure(pdfPath, contactEmail);
    } else if (scope?.pdf) {
      // Explicitly requested but not built → a failure, not a silent skip.
      pdf.ran = true;
      pdf.problems = [`PDF not found at ${pdfPath} — build it first (pnpm build:pdf).`];
    } else {
      pdf.skipped = true;
    }
  }

  const logPath = [join(root, 'build', 'resume.log'), join(root, 'resume.log')].find(existsSync)
    || join(root, 'build', 'resume.log');
  if (wantWidth) {
    if (existsSync(logPath)) {
      width.ran = true;
      width.problems = await checkLog(logPath, { maxOverfullPt: MAX_OVERFULL_PT });
    } else if (scope?.width) {
      width.ran = true;
      width.problems = [`LaTeX log not found at ${logPath} — build the PDF first (pnpm build:pdf).`];
    } else {
      width.skipped = true;
    }
  }

  const pass = [source, pdf, width].every((g) => g.problems.length === 0);
  return { source, pdf, width, pass };
}
