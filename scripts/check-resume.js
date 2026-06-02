#!/usr/bin/env node
// Resume structure checker.
//
//   node scripts/check-resume.js            # source + PDF (PDF skipped if absent)
//   node scripts/check-resume.js --source   # source only (no deps, used by the git hook)
//   node scripts/check-resume.js --pdf       # PDF only (fails if the PDF is missing)
//
// Exits non-zero if any requested check fails, so it works as a CI gate and a
// pre-commit hook.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkSource, REQUIRED_SECTIONS } from './lib/check-source.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'resume.tex');
const PDF = join(root, 'assets', 'resume.pdf');

// What the compiled PDF must look like.
const EXPECTED_PAGES = 1;
const MIN_TEXT_LENGTH = 200; // guards against an empty / image-only render
const CONTACT_EMAIL = 'sandy1711003@gmail.com';

const args = new Set(process.argv.slice(2));
const onlyFlags = args.has('--source') || args.has('--pdf');
const wantSource = args.has('--source') || !onlyFlags;
const wantPdf = args.has('--pdf') || !onlyFlags;
const pdfExplicit = args.has('--pdf');

function report(title, problems) {
  if (problems.length === 0) {
    console.log(`✓ ${title}: passed`);
    return true;
  }
  console.error(`✗ ${title}: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`    - ${p}`);
  return false;
}

let ok = true;

if (wantSource) {
  const problems = await checkSource(SOURCE);
  ok = report('Source structure (resume.tex)', problems) && ok;
}

if (wantPdf) {
  if (!existsSync(PDF)) {
    if (pdfExplicit) {
      ok =
        report('PDF structure (assets/resume.pdf)', [
          `PDF not found at ${PDF} — build it first (npm run build:pdf).`,
        ]) && ok;
    } else {
      console.log('• PDF structure: skipped (assets/resume.pdf not built yet)');
    }
  } else {
    const problems = [];
    try {
      // Imported lazily so the source-only path needs no node_modules.
      const { extractPdf } = await import('./lib/extract-pdf.js');
      const { text, totalPages } = await extractPdf(PDF);

      if (totalPages !== EXPECTED_PAGES) {
        problems.push(`Expected ${EXPECTED_PAGES} page(s), found ${totalPages}.`);
      }
      const compact = text.replace(/\s+/g, ' ').trim();
      if (compact.length < MIN_TEXT_LENGTH) {
        problems.push(
          `Extracted text is suspiciously short (${compact.length} chars) — PDF may be empty or image-only.`,
        );
      }
      for (const name of REQUIRED_SECTIONS) {
        // Allow flexible whitespace between words (PDF text can drop spaces).
        const re = new RegExp(
          name
            .split(/\s+/)
            .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('\\s*'),
          'i',
        );
        if (!re.test(text)) problems.push(`Section "${name}" not found in rendered PDF text.`);
      }
      if (!text.includes(CONTACT_EMAIL)) {
        problems.push(`Contact email ${CONTACT_EMAIL} not found in rendered PDF text.`);
      }
    } catch (err) {
      problems.push(`Failed to parse PDF: ${err.message}`);
    }
    ok = report('PDF structure (assets/resume.pdf)', problems) && ok;
  }
}

if (!ok) {
  console.error('\nResume structure check FAILED.');
  process.exit(1);
}
console.log('\nResume structure check passed.');
