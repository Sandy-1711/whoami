---
name: resume-latex
description: Safely edit and build the LaTeX résumé (resume.tex) in this repo — its custom macros, required sections, one-page/width constraints, TAILOR anchors, and the build+guard workflow. Use when changing résumé content or layout, fixing an overfull hbox, or the résumé fails its structure/page/width checks.
---

# Editing & building the LaTeX résumé

The canonical résumé is `resume.tex`. It compiles to a **single page** in CI and
is served on Vercel. Every change is gated by structure/page/width guards — never
ship a change that fails them.

## Hard constraints (the guards enforce these)
- **Exactly one page.** More than one page fails `check-resume.js --pdf`.
- **No horizontal overflow.** Any `Overfull \hbox` > 2pt fails the width check
  (`scripts/lib/check/log.js`, reads `build/resume.log`). This is invisible on
  screen but real — shorten the offending line.
- **Required sections must exist:** `Experience`, `Projects`, `Technical Skills`,
  `Education` (see `REQUIRED_SECTIONS` in `scripts/lib/check/source.js`).
- **Contact header** must keep the mailto, LinkedIn, and GitHub links.
- Custom list macros must be balanced: `\resumeSubHeadingListStart/End`,
  `\resumeItemListStart/End`. No empty `\resumeItem{}`.

## TAILOR anchors — do not hand-edit content, edit around them
`resume.tex` has three machine-managed blocks the tailor rewrites per JD:
```
%% >>>TAILOR:subtitle ... %% <<<TAILOR:subtitle
%% >>>TAILOR:summary  ... %% <<<TAILOR:summary
%% >>>TAILOR:skills   ... %% <<<TAILOR:skills
```
The content between markers is safe to edit by hand, but keep the marker lines
intact — `scripts/lib/tailor/core.js` (`replaceBlock`) depends on them.

## Build + verify workflow
LaTeX artifacts go into `build/` (never the repo root). Build needs a local
`latexmk` **or** Docker Desktop running (the repo's default path).
```
npm run build:pdf     # compile resume.tex -> build/ -> assets/resume.pdf
npm run check         # source + PDF + width guards
npm run verify        # build, then all guards (do this before committing)
npm run check:source  # structure only, no LaTeX needed (the pre-commit hook)
```
If Docker's daemon is down the build fails with a clear message — start Docker
Desktop and retry.

## Editing tips to hold one page
- Trim bullets rather than shrinking margins/font (parsers dislike tiny text).
- After ANY content edit, run `npm run verify` and fix page/width failures before
  committing. The git pre-commit hook runs the source check automatically.
