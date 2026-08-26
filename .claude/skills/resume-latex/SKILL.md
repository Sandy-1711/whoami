---
name: resume-latex
description: Safely edit and build the résumé in this repo — the document at profile/resume.json, its restricted markup, the one-page/width constraints, the LaTeX layer that renders it, and the build+guard workflow. Use when changing résumé content or layout, fixing an overfull hbox, or the résumé fails its structure/page/width checks.
---

# Editing & building the résumé

The résumé is **`profile/resume.json`**. `resume.tex` is rendered from it and is a
build artifact — editing the LaTeX by hand fails the source guard, which compares
the two. It compiles to a **single page** in CI and is served on Vercel.

## Where a change goes
| Changing | Edit |
|---|---|
| Wording, bullets, skills, dates, a link | `profile/resume.json` |
| Section order, spacing, fonts, margins, macros | `packages/core/src/resume/preamble.ts` and `render.ts` |
| What a JD-tailored version says | the tailoring pipeline, not the base document |

## Prose carries three markers and nothing else
`**bold**`, `[label](url)`, `` `code` ``. Everything else is literal text — the
renderer escapes it, so a `&`, `%` or `_` is safe to type and LaTeX in a string
prints rather than runs. Em dashes, en dashes and curly quotes are converted for
you; write them as the real characters.

Every entry and bullet has a stable `id`. Tailoring addresses bullets by id, so
do not renumber them casually — an id is a handle, not an index.

## Hard constraints (the guards enforce these)
- **Exactly one page.** More than one page fails `check-resume.ts --pdf`.
- **No horizontal overflow.** Any `Overfull \hbox` > 2pt fails the width check
  (`packages/core/src/check/log.ts`, reads `build/resume.log`). This is invisible
  on screen but real — shorten the offending line.
- **Required sections must exist:** `Experience`, `Projects`, `Technical Skills`,
  `Education` (see `REQUIRED_SECTIONS` in `packages/core/src/check/source.ts`). A
  section with no entries is not rendered at all, which is how you would lose one.
- **Contact header** must keep the mailto, LinkedIn, and GitHub links.
- **`resume.tex` must be what `resume.json` renders to** — rebuild after editing
  the document and commit both.

## Build + verify workflow
LaTeX artifacts go into `build/` (never the repo root). Build needs a local
`latexmk` **or** Docker Desktop running (the repo's default path).
```
pnpm build:pdf     # render resume.json -> resume.tex -> build/ -> assets/resume.pdf
pnpm check         # source + PDF + width guards
pnpm verify        # build, then all guards (do this before committing)
pnpm check:source  # structure + freshness only, no LaTeX needed (the pre-commit hook)
```
If Docker's daemon is down the build fails with a clear message — start Docker
Desktop and retry.

## Editing tips to hold one page
- Trim bullets rather than shrinking margins/font (parsers dislike tiny text).
- After ANY content edit, run `pnpm verify` and fix page/width failures before
  committing. The git pre-commit hook runs the source check automatically.
