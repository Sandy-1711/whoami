---
name: resume-facts
description: Edit the local profile data files by hand (in Claude Code, no API) — the verified fact base `profile/facts.json` (keywords, skills, metrics, title variants, identity) and `profile/curation.json` (pin/ban which repos feed the profile). Use when the user asks to add/remove a skill or keyword, fix an identity field, or hide/prioritize GitHub repos — instead of the paid agent's update_facts tool.
---

# Fact base & repo curation (hand edits, no API)

Both files are plain JSON you edit directly with Edit. No LLM needed. After any
change that affects résumé wording, remind the user to update `resume.tex` to
match (see `resume-latex`) and run `pnpm sync` to re-baseline drift.

## `profile/facts.json` — the verified fact base
The ONLY source the résumé and every draft may claim from. **Only add things that
are TRUE.** Validate against `profile/github.json` / `profile/linkedin.json`
before adding. Structure and the safe edits:

| Field | Shape | Edit |
|---|---|---|
| `allowed_keywords` | `string[]` | add/remove an ATS keyword. Dedupe case-insensitively. |
| `skills` | `{ [category]: string[] }` | add/remove a skill under a category (e.g. "AI/ML & LLM", "Backend & Ops", "Languages"). Keep each category's list sorted. |
| `headline_metrics` | `string[]` | add/remove a headline metric. |
| `title_variants` | `string[]` | add/remove a role-title variant. |
| `seniority` | `string` | one-line seniority framing (e.g. "early-career, graduating Aug 2026 — …"). Keep it honest; it steers how drafts frame experience. |
| `identity` | `{ name, location, email, github, linkedin, portfolio, graduation }` | **identity edits are outward-facing — SHOW the from→to and get explicit confirmation before writing.** |
| `experience`, `projects` | arrays of objects | structured; edit carefully, preserving existing shape. |

Rules:
- Dedupe case-insensitively; don't add a value that already exists.
- Never move a JD's "missing" keyword into facts.json unless the user confirms
  it's genuinely true — the "missing" list is off-limits by default.
- Write valid JSON (2-space indent, trailing newline) so it stays diff-clean.
- **Confirm identity changes** (name/email/github/linkedin/portfolio/graduation)
  before saving — they change the verified profile everything draws from.

## `profile/curation.json` — manual repo pin/ban
Controls which GitHub repos surface in the profile/enhancer copy and count toward
totals. **You edit it; `resume sync` never overwrites it.** Two lists:

```json
{ "pin": ["Web-Aware-Rag-Engine", "mastra-ai/mastra"], "ban": ["Portfolio", "reddit-clone-backend"] }
```

- **`ban`** — hidden everywhere: dropped from `github.json` on the next `resume
  sync`, excluded from LLM/profile prompts, and removed from the repo/star/PR totals.
- **`pin`** — always surfaced first, in listed order (beats star-sorting; a
  pinned fork surfaces too, flagged `pinned: true`).
- **Matching (case-insensitive):** own repos by bare name (`Web-Aware-Rag-Engine`)
  or `username/name`; external contribution repos by full `owner/name`
  (`mastra-ai/mastra`). A bare name won't ban an external contribution of the same
  name — use the full `owner/name` for those.

It's applied at scrape time (`resume sync` writes a curated `github.json`) and
again at read time by the **profile digest** (`pnpm digest` / the evidence block
in every drafting prompt) and the enhancer — so a curation edit takes effect
immediately, without re-syncing. Pin your strongest repos: the digest surfaces
only the top 8, pins first. Implementation:
`packages/core/src/profile/curation.ts` + `profile/digest.ts`.

## After editing
- Facts that change résumé wording → edit `resume.tex`, rebuild, run guards.
- `pnpm sync` to re-baseline the drift lock (and apply curation to `github.json`).
- `pnpm status` to confirm sources are fresh and the fact base looks right.
