---
name: resume-latex
description: Safely edit and build the LaTeX résumé (resume.tex) in this repo — its custom macros, required sections, one-page/width constraints, TAILOR anchors, and the build+guard workflow. Use when changing résumé content or layout, fixing an overfull hbox, or the résumé fails its structure/page/width checks.
---

# Editing & building the LaTeX résumé

The canonical résumé is `resume.tex`. It compiles to a **single page** in CI and
is served on Vercel. Every change is gated by structure/page/width guards — never
ship a change that fails them.

## Hard constraints (the guards enforce these)
- **Exactly one page.** More than one page fails `check-resume.ts --pdf`.
- **No horizontal overflow.** Any `Overfull \hbox` > 2pt fails the width check
  (`packages/core/src/check/log.ts`, reads `build/resume.log`). This is invisible
  on screen but real — shorten the offending line.
- **Required sections must exist:** `Experience`, `Projects`, `Technical Skills`,
  `Education` (see `REQUIRED_SECTIONS` in `packages/core/src/check/source.ts`).
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
intact — `packages/core/src/tailor/core.ts` (`replaceBlock`) depends on them.

## Build + verify workflow
LaTeX artifacts go into `build/` (never the repo root). Build needs a local
`latexmk` **or** Docker Desktop running (the repo's default path).
```
pnpm build:pdf     # compile resume.tex -> build/ -> assets/resume.pdf
pnpm check         # source + PDF + width guards
pnpm verify        # build, then all guards (do this before committing)
pnpm check:source  # structure only, no LaTeX needed (the pre-commit hook)
```
If Docker's daemon is down the build fails with a clear message — start Docker
Desktop and retry.

## Editing tips to hold one page
- Trim bullets rather than shrinking margins/font (parsers dislike tiny text).
- After ANY content edit, run `pnpm verify` and fix page/width failures before
  committing. The git pre-commit hook runs the source check automatically.
