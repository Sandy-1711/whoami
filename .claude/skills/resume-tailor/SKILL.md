---
name: resume-tailor
description: Run the JD-tailoring pipeline and keep the profile sources fresh — the `resume` CLI (tailor/sync/status), the company+role output naming, the fact base, and the scraped GitHub/LinkedIn JSON. Use when generating a tailored résumé for a company, refreshing scraped sources, or wiring up the pipeline's inputs.
---

# Tailoring pipeline & profile sources

One CLI drives everything: `pnpm resume` (interactive menu) or the direct
commands below. The tailor needs a Gemini or DeepSeek key in `.env`.

> **POLICY (see `job-copilot`):** `pnpm tailor` is the PAID path — 1–3 LLM
> calls per run. When Claude Code or an MCP client is doing the tailoring,
> write the summary/subtitle/skills yourself (edit `resume.tex` between the
> TAILOR anchors, see `resume-latex`), grounded in `pnpm score` + `pnpm digest`,
> and only run the paid pipeline when the user explicitly asks for it.

## Commands
```
pnpm resume                 # interactive menu (clack)
pnpm tailor -- jd.txt --company "Acme-AI" [--role "AI Dev Engineer"]   # PAID (LLM)
pnpm score -- jd.txt        # deterministic JD fit score — free, no LLM
pnpm digest                 # ranked GitHub/LinkedIn evidence — free, no LLM
pnpm sync -- --force        # re-scrape GitHub now (LinkedIn ONLY with --linkedin)
pnpm status                 # env, sources, toolchain, outputs at a glance
```

The toolkit is also an MCP server (`pnpm mcp`) exposing 19 tools to Claude
Code/Cursor/Claude Desktop — same free/paid split, listed in `job-copilot`.

## Output naming (company + role)
`--company "Acme-AI"` + a role read from the JD →
`tailored/acme_ai/Sandeep Singh - AI Dev Engineer.pdf`
- Company → folder slug (lowercase, non-alnum → `_`).
- Role comes from Gemini reading the JD; falls back to a regex, then
  "Software Engineer". Override with `--role`.
- Logic lives in `packages/core/src/naming.ts`. The PDF compiles under a safe
  `build/` jobname, then is copied to the pretty spaced path.

## Sources of truth (order of authority)
1. `profile/facts.json` — hand-verified. The **only** thing the tailor may claim
   from. Never let the model invent beyond it.
2. `profile/github.json` — scraped repos + PR contributions (merged/open/closed,
   stars). Editable. Refreshed by `pnpm sync` (GitHub API).
3. `profile/linkedin.json` — **opt-in**: refreshed only by `pnpm sync --linkedin`
   (live scrape via Playwright + `LINKEDIN_COOKIE`, or parsed from
   `Linkedin_Profile.pdf`; the structuring step uses Gemini). Editable. Scraping
   LinkedIn is against its ToS — hence the explicit opt-in.

## The digest — how the scrapes reach the LLM
The pipeline no longer ignores the scrapes: every drafting prompt (tailor,
email, outreach, wellfound) gets a deterministic ~2 KB **profile digest** —
top repos (curation pins first, forks/archived/banned excluded, ranked by
stars/recency/description), external contributions with merged-PR counts and
sample titles, and LinkedIn role one-liners — as *evidence for what to
emphasize*. facts.json remains the only source of claims. Inspect it with
`pnpm digest` (`--json` for structured); curate it via `profile/curation.json`
(see `resume-facts`). Implementation: `packages/core/src/profile/digest.ts`.

Scraped JSON is **committed and hand-editable** — your edits persist until a
scrape changes that field. Freshness + content hashes live in
`profile/sources.lock.json`; a source re-scrapes only when older than
`SCRAPE_TTL_HOURS` (default 12) or `--force`, and the file is rewritten only when
the content hash changes. The tailor refreshes sources automatically before each
run (fail-soft: a scrape error falls back to cached data).

## Adding a new true fact
Verify it in `profile/github.json` / `profile/linkedin.json`, add it to
`profile/facts.json` (allowed_keywords / skills / experience / projects), then
`pnpm sync` to re-baseline drift. Only then will the tailor surface it.

## Setup notes
- Copy `.env.example` → `.env`, set `GEMINI_API_KEY`. Optional: `GITHUB_TOKEN`
  (higher rate limit), `LINKEDIN_COOKIE` + `pnpm add -D playwright && pnpm exec
  playwright install chromium` (live LinkedIn scrape, opt-in via `--linkedin`).
- The raw `Linkedin_Profile.pdf` and `linkedin-updates.md` are gitignored — the
  repo is public; never commit them.
