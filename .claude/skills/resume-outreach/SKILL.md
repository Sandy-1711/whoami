---
name: resume-outreach
description: Draft job-search copy yourself (in Claude Code, no API spend) grounded in the fact base — Wellfound application-box notes, the standing Wellfound profile, cold emails, LinkedIn DMs, follow-ups, referral asks, and LinkedIn/GitHub profile-copy suggestions. Use when the user asks for "a note for X", "a cold email", "a DM", "a follow-up", "a referral message", or better LinkedIn/GitHub copy — instead of running `pnpm wellfound`/`pnpm email` (which call Gemini/DeepSeek).
---

# Outreach & profile copy (you draft it — no API)

The paid CLI/agent generate these with Gemini/DeepSeek (`pnpm wellfound`,
`pnpm email`, `pnpm wellfound-profile`). Draft them yourself here instead — same
grounding rules, same output files, no API spend.

**Always first:** read `profile/facts.json`. Every claim (employer, metric,
project, skill) must come from it. Never invent. Refer to the Indigle/Samagra
role as **"Founding Software Engineer"** — never "co-founder"/"CTO". Plain text,
first person, confident, specific to THIS company/role. No clichés, no "I am
passionate about". One sharp hook beats three adjectives.

For a JD, also skim `resume.tex` so you lean on real matched keywords, not gaps.

## Message specs (match these exactly)
| Kind | Length | Subject? | Brief |
|---|---|---|---|
| **Wellfound note** | ~80–110 words | no | The "What interests you about this role?" box. Lead with the single most relevant proof point; tie to the company's real product/stack; one soft close. |
| **cold_email** | ≤130 words | yes | To a hiring manager/founder. One clear ask (a quick chat or to be considered). Lead with the strongest proof point. |
| **linkedin_dm** | ≤60 words | no | Connection/DM note. LinkedIn caps ~300 chars. Warm, specific, one hook, one soft ask. |
| **followup** | ≤90 words | yes | After applying / an unanswered message. Reference the prior touch, add one new proof point, restate the ask lightly. Not pushy. |
| **referral_ask** | ≤100 words | no | Ask a contact (often a stranger who works there) for a referral. Make it easy: one line on why you fit; offer your résumé/links. |

If early-career relative to the ask, frame as "already shipping in this exact
stack, reviewed by maintainers" — do not apologize.

## Output file conventions (write to the same paths the CLI uses)
- **Wellfound note:** `tailored/<company-slug>/wellfound-message.txt` — just the
  message text + trailing newline. Slug = company lowercased, non-alphanumeric → `_`
  (e.g. "Tax Pilot" → `tax_pilot`, "Inteligen-ai" → `inteligen_ai`).
- **Cold email / DM / follow-up / referral:** show it in chat. If the user wants
  it saved, put it under `tailored/<company-slug>/` with a descriptive name
  (`cold-email.txt`, `linkedin-dm.txt`). These are drafts — don't send.
- **Standing Wellfound profile:** `wellfound-profile.md` at repo root (gitignored).
- **LinkedIn/GitHub suggestions:** `linkedin-updates.md` at repo root (gitignored).

After drafting a note for a JD, offer to log it in the tracker (see `job-copilot`)
and mention the timezone overlap if the role lists collaboration hours (he's IST).

## Standing Wellfound profile (`wellfound-profile.md`)
One doc for every role (like LinkedIn), grounded in facts.json. Sections:
headline; bio (**≤300 chars**); "What I'm looking for"; achievements (bullets);
skills (tags, most important first); a short blurb per experience role. Note it's
gitignored — paste-ready copy, safe to keep verbatim.

## LinkedIn / GitHub profile copy (the "enhancer", `linkedin-updates.md`)
Compare facts.json to the live `profile/linkedin.json` + `profile/github.json`
scrape and propose truthful, better copy:
- **LinkedIn headline** — one line, ≤220 chars, lead with strongest positioning.
- **LinkedIn about** — 3–5 tight first-person sentences, metric-led.
- **Skills to add** — TRUE skills (in facts.json) missing from the current LinkedIn list.
- **GitHub bio** — ≤160 chars, punchy: current focus + strongest proof.
- **Stale/missing** — concrete gaps where a live surface omits/contradicts the
  fact base (e.g. "LinkedIn headline omits Mastra", "GitHub bio missing").

For the top GitHub repos, prefer `pinned` repos then non-forks (see `curation.json`
in `resume-facts`). These are suggestions — the user pastes them into LinkedIn/GitHub
by hand; don't push. To actually push a GitHub bio/README, that's an outward action
needing confirmation — use `gh` or ask the user.
