---
name: resume-tailor
description: Run the JD-tailoring pipeline and keep the profile sources fresh — the `resume` CLI (tailor/sync/status), the company+role output naming, the fact base, and the scraped GitHub/LinkedIn JSON. Use when generating a tailored résumé for a company, refreshing scraped sources, or wiring up the pipeline's inputs.
---

# Tailoring pipeline & profile sources

One CLI drives everything: `npm run resume` (interactive menu) or the direct
commands below. Gemini is **required** (`GEMINI_API_KEY` in `.env`); there is no
offline mode.

## Commands
```
npm run resume                 # interactive menu (clack)
npm run tailor -- jd.txt --company "Inteligen-ai" [--role "AI Dev Engineer"]
npm run sync -- --force        # re-scrape GitHub + LinkedIn now
npm run status                 # env, sources, toolchain, outputs at a glance
```

## Output naming (company + role)
`--company "Inteligen-ai"` + a role read from the JD →
`tailored/inteligen_ai/Sandeep Singh - AI Dev Engineer.pdf`
- Company → folder slug (lowercase, non-alnum → `_`).
- Role comes from Gemini reading the JD; falls back to a regex, then
  "Software Engineer". Override with `--role`.
- Logic lives in `scripts/lib/naming.js`. The PDF compiles under a safe
  `build/` jobname, then is copied to the pretty spaced path.

## Sources of truth (order of authority)
1. `profile/facts.json` — hand-verified. The **only** thing the tailor may claim
   from. Never let the model invent beyond it.
2. `profile/github.json` — scraped repos + PR contributions (merged/open/closed,
   stars). Editable.
3. `profile/linkedin.json` — scraped from the live profile (Playwright + the
   `LINKEDIN_COOKIE`) or, by default, parsed from `Linkedin_Profile.pdf`; then
   structured by Gemini. Editable.

Scraped JSON is **committed and hand-editable** — your edits persist until a
scrape changes that field. Freshness + content hashes live in
`profile/sources.lock.json`; a source re-scrapes only when older than
`SCRAPE_TTL_HOURS` (default 12) or `--force`, and the file is rewritten only when
the content hash changes. The tailor refreshes sources automatically before each
run (fail-soft: a scrape error falls back to cached data).

## Adding a new true fact
Verify it in `profile/github.json` / `profile/linkedin.json`, add it to
`profile/facts.json` (allowed_keywords / skills / experience / projects), then
`npm run sync` to re-baseline drift. Only then will the tailor surface it.

## Setup notes
- Copy `.env.example` → `.env`, set `GEMINI_API_KEY`. Optional: `GITHUB_TOKEN`
  (higher rate limit), `LINKEDIN_COOKIE` + `npm i -D playwright && npx playwright
  install chromium` (live LinkedIn scrape).
- The raw `Linkedin_Profile.pdf` and `linkedin-updates.md` are gitignored — the
  repo is public; never commit them.
