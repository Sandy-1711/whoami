---
name: resume-ats
description: Check and improve the résumé's ATS keyword coverage against a job description. Use when the user asks to score a résumé, raise its ATS match, analyze a JD's keywords, or decide which skills to surface — for the LaTeX résumé in this repo (resume.tex + profile/facts.json).
---

# Résumé ATS checking & improvement

This repo scores the résumé against a JD deterministically and rewrites the
summary/subtitle with Gemini. Scoring is transparent, not a black box.

## How scoring works
- `scripts/lib/tailor/core.js` extracts JD keywords from a fixed lexicon
  (`TECH_LEXICON` + `ALIASES`), then classifies each against the résumé text and
  the **fact base** (`profile/facts.json`):
  - **matched** — already in `resume.tex`.
  - **addable** — TRUE (present in the fact base) but not yet on the résumé → surface these to raise the score.
  - **missing** — the JD wants it and it's NOT in the fact base → a real gap.
- Score = 20 (structure) + 80 × (matched ÷ total keywords). "After" adds the
  addable keywords. Target is **92+**.

## To run a check
```
npm run tailor -- path/to/jd.txt --company "Acme AI"
```
This prints the score table, the matched/addable/missing chips, and writes a
report next to the PDF. The full report is also saved as
`tailored/<company>/<Name> - <Role>.report.md`.

## Rules when improving
1. **Never fabricate.** Only claim keywords/metrics present in `profile/facts.json`.
   The "missing" list is off-limits unless the user confirms it's genuinely true —
   then add it to `profile/facts.json` (and the résumé), not just the prose.
2. **Raise coverage by surfacing "addable" terms** in the summary, subtitle, or
   Technical Skills — things already true but not yet visible to the parser.
3. **Keep it one page.** Adding keywords must not overflow — re-run the guards
   (see the `resume-latex` skill) after any edit.
4. To broaden what the scorer recognizes, extend `TECH_LEXICON`/`ALIASES` in
   `scripts/lib/tailor/core.js` — but only with real synonyms.

## Where the truth lives
- `profile/facts.json` — hand-verified fact base (the only source the tailor may claim from).
- `profile/github.json`, `profile/linkedin.json` — scraped, editable sources (`npm run sync`). Use them to justify adding a new true fact to `facts.json`.
