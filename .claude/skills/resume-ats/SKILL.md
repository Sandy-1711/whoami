---
name: resume-ats
description: Check and improve the résumé's ATS keyword coverage against a job description. Use when the user asks to score a résumé, raise its ATS match, analyze a JD's keywords, or decide which skills to surface — for the LaTeX résumé in this repo (resume.tex + profile/facts.json).
---

# Résumé ATS checking & improvement

Scoring is **fully deterministic** — pure keyword matching and arithmetic, no
LLM, no cost, transparent. (Only the *rewriting* in `pnpm tailor` uses a model.)

## How scoring works
- `packages/core/src/tailor/core.ts` extracts JD keywords from a fixed lexicon
  (`TECH_LEXICON` + `ALIASES`), then classifies each against the résumé text and
  the **fact base** (`profile/facts.json`):
  - **matched** — already in `resume.tex`.
  - **addable** — TRUE (present in the fact base) but not yet on the résumé → surface these to raise the score.
  - **missing** — the JD wants it and it's NOT in the fact base → a real gap.
- Score = 20 (structure) + 80 × (matched ÷ total keywords). "After" adds the
  addable keywords. Target is **92+**.

## To run a check (free — always use this, never the paid tailor)
```
pnpm score -- path/to/jd.txt        # or: pnpm score -- --jd "pasted text…"
```
Prints the before/after score table and the matched/addable/missing chips.
Instant, no LLM, no PDF. Over MCP the same check is the `score_jd` tool.
(`pnpm tailor` also prints a score, but runs the full paid LLM pipeline —
don't use it just to see a number.)

## Improving the score (POLICY: you write the text yourself)
Scoring goes through the tool above; the résumé edits that raise it are TEXT —
per the policy in `job-copilot`, **you** surface the addable keywords by editing
`resume.tex` directly (see `resume-latex`), then re-run `pnpm score` to confirm.
Run `pnpm digest` first so you emphasize the strongest real evidence.

## Rules when improving
1. **Never fabricate.** Only claim keywords/metrics present in `profile/facts.json`.
   The "missing" list is off-limits unless the user confirms it's genuinely true —
   then add it to `profile/facts.json` (and the résumé), not just the prose.
2. **Raise coverage by surfacing "addable" terms** in the summary, subtitle, or
   Technical Skills — things already true but not yet visible to the parser.
3. **Keep it one page.** Adding keywords must not overflow — re-run the guards
   (see the `resume-latex` skill) after any edit.
4. To broaden what the scorer recognizes, extend `TECH_LEXICON`/`ALIASES` in
   `packages/core/src/tailor/core.ts` — but only with real synonyms.

## Where the truth lives
- `profile/facts.json` — hand-verified fact base (the only source the tailor may claim from).
- `pnpm digest` — ranked GitHub/LinkedIn evidence (top repos, merged PRs, roles);
  use it to pick WHICH addable keywords deserve the summary vs a skills line.
- `profile/github.json`, `profile/linkedin.json` — raw scraped sources
  (`pnpm sync`; LinkedIn opt-in via `--linkedin`). Use them to justify adding a
  new true fact to `facts.json`.
