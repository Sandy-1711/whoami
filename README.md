# Resume CI/CD

[![Build & Deploy](https://github.com/Sandy-1711/whoami/actions/workflows/build-deploy.yml/badge.svg)](https://github.com/Sandy-1711/whoami/actions/workflows/build-deploy.yml)
[![Last updated](https://img.shields.io/github/last-commit/Sandy-1711/whoami?label=last%20updated)](https://github.com/Sandy-1711/whoami/commits/main)
[![Resume views](https://img.shields.io/endpoint?url=https%3A%2F%2Fiamsandeep.vercel.app%2Fapi%2Fbadge)](https://iamsandeep.vercel.app)

My résumé as a self-deploying system: written in **LaTeX**, compiled to **PDF** by
**GitHub Actions**, and served as a **view-counted PDF** through **Vercel serverless
functions**. Git is the single source of truth — every push to `main` re-validates,
recompiles, and redeploys the live link automatically. No manual builds, no PDF
checked into the repo, no clicking "export" in an editor.

**Live:** https://iamsandeep.vercel.app  ·  **Download:** https://iamsandeep.vercel.app/?download=1

---

## Why it's built this way

A résumé is a document that changes rarely but must always be correct, current, and
instantly shareable. Treating it as a tiny software project gets all of that for free:

- **One source of truth.** The résumé lives in `resume.tex`. The PDF is a build
  artifact, never committed — so the repo can never drift from what's published.
- **Every change is reviewed by CI.** A push can't ship a résumé that fails to
  compile or loses a section — the pipeline gates on a structure check before it
  ever deploys.
- **A stable, shareable URL.** `iamsandeep.vercel.app` always serves the latest
  résumé; the link in an application never goes stale.
- **Lightweight analytics.** A view counter (resilient, privacy-light — just an
  integer) shows whether the link is actually being opened, surfaced as a live badge.

---

## Architecture

```
 resume.tex ──git push──► GitHub repo
     │
     ▼  GitHub Actions (CI/CD) — .github/workflows/build-deploy.yml
   1. install deps + check résumé SOURCE structure   (fail fast, no LaTeX needed)
   2. compile resume.tex → resume.pdf                 (xu-cheng/latex-action, full TeXLive)
   3. stage it at apps/web/assets/resume.pdf
   4. check the compiled PDF structure                (1 page, sections present, contact intact)
   5. deploy to Vercel                                (vercel CLI + token)
     │
     ▼  Vercel (hosting / serverless)
   /  and  /resume.pdf  → apps/web/api/resume.ts:
        a. INCR a view counter in Upstash Redis / Vercel KV
        b. stream resume.pdf   (inline; ?download=1 → attachment, named file)
   /api/stats  → { "views": N }
   /api/badge  → shields.io endpoint JSON (powers the "resume views" badge)
```

The PDF is **bundled into the serverless function** at deploy time (via
`vercel.json` → `includeFiles`), so the function serves it from local disk with no
external storage to read on each request.

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| **Document** | LaTeX (`latexmk`, TeXLive) | Precise, version-controllable typesetting; clean, ATS-readable text layer. |
| **CI/CD** | GitHub Actions | Compile + validate + deploy on every push; no local toolchain required. |
| **LaTeX build** | `xu-cheng/latex-action` | Full TeXLive in a container — no fragile local TeX install. |
| **Hosting / API** | Vercel serverless functions (Node.js, ESM) | Zero-ops, scales to zero, stable URL, env-var secrets. |
| **View counter** | Upstash Redis / Vercel KV (`@upstash/redis`) | Serverless-friendly Redis over HTTP; a single `INCR`. |
| **Badge** | shields.io endpoint | Live view count rendered from `/api/badge` JSON. |
| **Quality gate** | Node structure checker (`unpdf`) + git pre-commit hook | Catches broken LaTeX / missing sections before deploy. |

---

## Project structure

```
.
├── resume.tex                  # the résumé — LaTeX source, the single source of truth
├── profile/                    # inputs to the tailoring pipeline
│   ├── facts.json              # hand-verified fact base — the only truth the tailor may claim
│   ├── github.json             # scraped repos + PR contributions (editable, committed)
│   ├── linkedin.json           # scraped LinkedIn profile (editable, committed)
│   ├── curation.json           # hand-maintained repo pin/ban list (sync never overwrites it)
│   └── sources.lock.json       # file-drift hashes + scrape freshness/content hashes
├── packages/core/              # @resume/core — the domain, ports + adapters (DI)
│   └── src/
│       ├── ports/              # interfaces: llm · http · latex · logger · config · mailer
│       ├── llm/                # LlmProviderRegistry + providers/gemini.ts, deepseek.ts
│       ├── tailor/             # TailorService · core.ts (scoring/injection) · report.ts
│       ├── email/              # EmailService — draft a JD email + send via the Mailer port
│       ├── wellfound/          # WellfoundService — application-box note + standing profile
│       ├── enhance/            # EnhanceService — profile copy vs the live scrape (paste-ready)
│       ├── outreach/           # OutreachService — cold email / DM / follow-up / referral
│       ├── github/             # GithubProfileService — bio / repo-description / README writes
│       ├── scrape/             # github.ts · linkedin.ts · refresh.ts (SourceRefresher)
│       ├── check/              # source.ts · log.ts (width) · pdf.ts (unpdf seam)
│       ├── profile/            # sources.ts (file-drift + freshness) · curation.ts · facts-editor.ts
│       └── prompts.ts naming.ts format.ts types.ts index.ts
├── packages/agent/             # @resume/agent — the Mastra chat agent (every capability as a tool)
│   └── src/
│       ├── agent.ts            # buildAgent — model + memory + tools assembly
│       ├── model.ts            # AppConfig → AI SDK model (Gemini/DeepSeek); chat-model resolution
│       ├── memory.ts           # libSQL memory: threads + working memory + semantic recall
│       ├── instructions.ts     # the copilot system prompt (STRICT grounding in facts.json)
│       └── tools/              # readonly · pipeline · email · wellfound · facts · enhance · github · outreach · tracker
├── apps/cli/                   # @resume/cli — `resume` toolkit shell
│   └── src/
│       ├── main.ts             # entrypoint (interactive menu + dispatch)
│       ├── container.ts        # composition root — wires adapters + registers providers
│       ├── commands/           # chat · tailor · email · wellfound · wellfound-profile · sync · status · build · check
│       ├── adapters/           # http · latex · config (dotenv) · presenter (clack) · mailer (nodemailer/Gmail)
│       └── build-pdf.ts check-resume.ts ui.ts args.ts paths.ts
├── apps/web/                   # @resume/web — Vercel app (self-contained; deploy root)
│   ├── api/                    # resume.ts · stats.ts · badge.ts · og.ts
│   ├── lib/                    # view-counter.ts (ViewCounter port) · redis.ts · …
│   ├── apps/web/assets/resume.pdf       # compiled by CI — gitignored, never committed
│   └── vercel.json
├── .agent/                     # chat memory, application tracker — gitignored, machine-local
├── .claude/skills/             # resume-ats · resume-latex · resume-tailor · resume-facts · resume-outreach …
├── build/                      # LaTeX artifacts (.aux/.log/.pdf …) — gitignored
├── tailored/                   # per-JD outputs, tailored/<company>/… — gitignored
├── .githooks/pre-commit        # runs the source check when resume.tex is committed
├── .github/workflows/build-deploy.yml   # CI/CD: check → compile → check → deploy
└── pnpm-workspace.yaml  turbo.json  tsconfig.base.json  package.json  .env.example
```

---

## How it works

### The request lifecycle (`apps/web/api/resume.ts`)

1. On cold start, the function reads `apps/web/assets/resume.pdf` from disk **once** and keeps
   it in memory.
2. On each request it issues an `INCR resume:views` to the KV store, then streams the
   PDF. If the counter ever fails, the PDF is **still served** — serving the résumé
   always wins over counting it.
3. `Cache-Control: no-store` is set so the CDN doesn't cache the response — every open
   re-invokes the function and is counted.
4. `?download=1` switches `Content-Disposition` from `inline` to `attachment`, and the
   file saves under a human-readable name (`Sandeep Singh - AI Engineer.pdf`) via both
   the quoted `filename` and the RFC 5987 `filename*` form.

### Link previews (Open Graph)

A raw PDF carries no HTML `<head>`, so a shared link would normally unfurl with no
preview card. To fix that without changing what humans see, `apps/web/api/resume.ts` checks the
`User-Agent`: **social link-preview crawlers** (Slack, Twitter/X, LinkedIn, WhatsApp,
Telegram, Discord, Facebook, …) receive a tiny HTML page carrying the OG / Twitter
tags, while every human still gets the PDF inline. The tags point `og:image` at
`/og.jpg`, served by `api/og.js` (the image is bundled into the function via
`includeFiles`, like the PDF). General search engines are intentionally **not** in the
crawler list, so we never serve them different content than humans.

### The CI/CD pipeline (`.github/workflows/build-deploy.yml`)

On every push to `main` (or manual `workflow_dispatch`):

1. **Setup + install** Node and dependencies.
2. **Source check** — `pnpm --filter @resume/cli check:source` (fails fast on broken
   LaTeX before spending time compiling).
3. **Compile** `resume.tex` → `resume.pdf` with full TeXLive.
4. **Stage** the PDF at `apps/web/assets/resume.pdf` and upload it as a build artifact.
5. **PDF check** — `pnpm --filter @resume/cli check:pdf` (verifies the rendered output).
6. **Deploy** to Vercel production with the CLI + token secrets.

A `concurrency` group cancels any in-progress run when a newer push arrives, so only
the latest commit deploys — no racing or stale deploys.

### View counting (`lib/redis.js`)

`makeRedis()` returns a client only if a store is configured, accepting **either**
naming convention — `UPSTASH_REDIS_REST_*` (Upstash integration) or `KV_REST_API_*`
(Vercel KV). If neither is set it returns `null`, and the résumé still serves; views
simply aren't counted until a store is connected.

---

## Endpoints

| Path | Returns |
| --- | --- |
| `/` and `/resume.pdf` | the résumé PDF inline (or an OG preview page to social crawlers — see below) |
| `/?download=1` | the same PDF as a download (`Sandeep Singh - AI Engineer.pdf`) |
| `/og.jpg` | the Open Graph preview image (`api/og.js`) |
| `/api/stats` | `{ "views": N }` |
| `/api/badge` | shields.io endpoint JSON powering the "resume views" badge |

---

## Structure check

A dependency-light checker validates the résumé's structure so a broken layout never
ships. It runs in two phases:

- **Source** (`resume.tex`) — required sections present, balanced
  environments / braces / list-macros, contact links intact, no empty bullets. Pure
  Node, **no LaTeX needed**.
- **PDF** (`apps/web/assets/resume.pdf`) — exactly one page, all sections survive into the
  rendered text, contact email present. Uses [`unpdf`](https://github.com/unjs/unpdf)
  (a Node-friendly build of pdf.js).
- **Width** (`build/resume.log`) — parses the LaTeX log for `Overfull \hbox` warnings and
  fails if any line runs more than 2pt past the page width. The page check catches
  *vertical* overflow (a spilled page); this catches the *horizontal* kind, which
  doesn't add a page and would otherwise slip through.

```bash
pnpm check          # source + PDF + width (compiled checks skipped if not built)
pnpm check:source   # source only
pnpm check:pdf      # PDF pages/sections + width (needs apps/web/assets/resume.pdf + build/resume.log)
pnpm check:width    # width only (needs build/resume.log)
```

It runs automatically in two places:

- **Pre-commit hook** (`.githooks/pre-commit`) — runs the source check whenever a
  commit touches `resume.tex`. Wired by the `prepare` script on `pnpm install`
  (`git config core.hooksPath .githooks`); bypass once with `git commit --no-verify`.
- **CI** — the source check gates the build before compiling, and the PDF check runs
  on the freshly compiled PDF before deploy.

The PDF text extraction lives in `packages/core/src/check/pdf.ts` as a reusable seam, so
the same extraction feeds the tailoring pipeline's ATS scoring.

---

## Edit the résumé

Edit `resume.tex`, then commit and push to `main`:

```bash
git add resume.tex
git commit -m "Update resume"   # pre-commit hook validates the source
git push                        # CI recompiles, re-checks, and redeploys
```

No manual build needed — the live link updates automatically once CI finishes.

---

## Local development

You **don't** need LaTeX installed to work on the functions — CI builds the PDF.

```bash
pnpm install                       # installs deps and wires the pre-commit hook
# put any PDF at apps/web/assets/resume.pdf as a stand-in (CI generates the real one)
pnpm dev                       # vercel dev → http://localhost:3000
```

To compile and validate the LaTeX locally — **no LaTeX install needed if you have
Docker** (it uses the same full TeXLive image as CI):

```bash
pnpm verify                    # build the PDF (Docker or local latexmk) + run all guards
pnpm build:pdf                 # just build via Docker/latexmk → apps/web/assets/resume.pdf
```

`pnpm verify` prefers a local `latexmk` if you have one, otherwise falls back to
Docker (`texlive/texlive`, cached after first pull). This gives the exact page/width
gate CI runs, without pushing — the fast local loop for iterating on layout.

If you do have TeXLive/MiKTeX installed, `pnpm build:pdf` uses it directly.

---

## Job-search toolkit — the `resume` CLI + chat agent

A companion toolkit turns a JD into an ATS-optimized, company-named PDF — **without**
touching your canonical `resume.tex` — and helps run the rest of a job search (emails,
Wellfound notes, outreach, application tracking). Everything is grounded in a **verified
fact base** (`profile/facts.json`), so it never fabricates experience, and it works with
**Gemini or DeepSeek** (set at least one key; there's no offline mode for LLM steps).

There are **three ways to drive it**: a conversational **chat agent** that wraps every
capability as a tool and calls them for you, the **individual commands** run directly, or an
**MCP server** that hands the same tools to an external agent like Claude Code or Cursor.

```bash
cp .env.example .env             # set GEMINI_API_KEY and/or DEEPSEEK_API_KEY (see the file)

pnpm chat                     # ⭐ conversational agent — every capability as a tool
pnpm mcp                      # serve the tools over MCP (stdio) to Claude Code / Cursor
pnpm resume                   # interactive menu (clack) — the same commands, guided
pnpm tailor -- jd.txt --company "Acme-AI" [--role "AI Dev Engineer"]
pnpm email  -- jd.txt --company "Northwind AI"   # draft + send a Gmail application email
pnpm wellfound -- jd.txt --company "Acme AI"     # the "why this role?" application-box note
pnpm score -- jd.txt          # deterministic JD fit score — free, no LLM
pnpm digest                   # ranked GitHub/LinkedIn evidence digest — free, no LLM
pnpm sync -- --force          # re-scrape GitHub now (LinkedIn is opt-in: --linkedin)
pnpm status                   # env, sources, toolchain, and outputs at a glance
```

### Chat — the agent (`pnpm chat`)

A streaming REPL over a **Mastra** agent (Gemini or DeepSeek) that has the whole toolkit as
tools — score a JD, tailor, draft/send email, Wellfound notes, outreach messages, sync,
build, check, edit the fact base, update the GitHub profile, track applications — and calls
them for you. Text and the model's live **thinking** stream back; tool calls show as dim
lines; irreversible actions (sending email, GitHub writes) require a terminal confirm.

Conversation **memory persists** across sessions in gitignored `.agent/` (libSQL): past
threads, a working-memory scratchpad, and — opt-in via `AGENT_RECALL=1` — semantic recall
(it costs an embedding round-trip per turn, so it's off by default). Slash commands
include `/model` (switch model), `/usage` (token spend + context window), `/threads`,
`/paste` and `/jd <file>` (attach a JD), `/status`, `/facts`. The chat **prefers Gemini**
whenever a Gemini key is set (fast time-to-first-token) and defaults to `gemini-2.5-flash`,
decoupled from the pipeline's `GEMINI_MODEL`/`LLM_PROVIDER`; steer it explicitly with
`AGENT_PROVIDER` / `AGENT_MODEL`. Answers render markdown (headers, bold, code) in the
terminal; set `RESUME_PLAIN=1` for raw text. See [docs/CLI.md](docs/CLI.md) for the full
command + slash-command reference.

### MCP — serve the tools to Claude Code / Cursor (`pnpm mcp`)

The same tools, exposed over the [Model Context Protocol](https://modelcontextprotocol.io) on
stdio, so an **external agent drives them** — 19 tools in all. Free/read-only:
`score_jd`, `read_facts`, `read_profile_digest`, `profile_status`, `list_outputs`,
`list_applications`; local ops: `build_resume`, `check_resume`, `sync_profiles`,
`update_facts`, `log_application`; **paid (LLM)**: `tailor_resume`,
`draft_application_email`, `outreach_message`, `wellfound_note`, `wellfound_profile`,
`profile_enhancer`; confirm-gated outward actions: `send_application_email`,
`update_github_profile`. It's a pure tool provider (no model, no chat memory): the
connecting client brings the model and decides what to call. The repo ships a project-scoped
[`.mcp.json`](.mcp.json), so **Claude Code auto-discovers it** when you open this repo — approve
it and run `/mcp` to check status. Env is read from `.env` at the repo root, same as the CLI.
The client prompts before each tool call, so that prompt is the human-in-the-loop for sends and
pushes. See [docs/CLI.md](docs/CLI.md#mcp--serve-the-tools-over-mcp-for-claude-code--cursor--claude-desktop)
for details.

- **Application email** — `pnpm email -- jd.txt --company "Northwind AI"` drafts a
  JD-tailored email from the same fact base, reads the apply-to address and subject
  straight from the JD, and auto-attaches the tailored résumé PDF from
  `tailored/<company>/` (override with `--attach <pdf>` or `--no-attach`). It then
  **shows the draft and only sends after you confirm the recipient** — sending goes
  through Gmail using a **Google App Password** (`GMAIL_USER` + `GMAIL_APP_PASSWORD` in
  `.env`; see `.env.example`). Without those it drafts only. Flags: `--to <addr>` to set
  the recipient, `--yes` to skip the confirm (for automation), `--dry-run` to preview
  only. On a real run the draft is written to `tailored/<company>/application-email.txt`;
  a `--dry-run` is a read-only preview that never overwrites an existing draft.

- **Output naming** — the résumé is filed and named by company + the role read from the
  JD: `--company "Acme-AI"` → `tailored/acme_ai/Sandeep Singh - AI Dev
  Engineer.pdf` (with matching `.tex` and `.report.md`). Gemini reads the role from the
  JD; a regex is the fallback, then `Software Engineer`. Override with `--role`.
- **Score** — 20 pts structure + 80 pts weighted JD-keyword coverage (deterministic, in
  `packages/core/src/tailor/core.ts`). The report splits keywords into **matched** (already in
  the résumé), **surface** (true & JD-relevant — add these to lift the score), and
  **gaps** (the JD wants them but they're not in your fact base — flagged so you never
  fake them).
- **Anchors** — the tailor only rewrites the `%% >>>TAILOR:…` blocks in `resume.tex`
  (summary, subtitle, skills). `tailored/` is gitignored (personal, regenerated).
- **Provider choice** — Gemini or DeepSeek, behind a registry. Pick per run with
  `--provider gemini|deepseek` (and `--model`), or set the default with `LLM_PROVIDER`.
  The chat agent picks its own via `AGENT_PROVIDER` / `AGENT_MODEL`.
- **Repo curation** — `profile/curation.json` is a hand-maintained `pin`/`ban` list
  (`sync` never overwrites it): banned repos are dropped everywhere (and from repo/star
  totals), pinned ones surface first. Applied on `sync` and whenever a prompt reads the
  scrape. Own repos match by name, external contributions by full `owner/name`.

### Profile sources (scraped, tracked, editable)

`pnpm sync` refreshes the committed, hand-editable sources of truth; the tailor also
refreshes them automatically before each run (fail-soft — a scrape error falls back to
cached data):

- **`profile/github.json`** — your public repos + PR contributions (merged/open/closed
  tallies, stars) from the GitHub REST API. Set `GITHUB_TOKEN` for a higher rate limit.
- **`profile/linkedin.json`** — your LinkedIn profile. **Opt-in**: refreshed only with
  `pnpm sync -- --linkedin` (scraping LinkedIn is against its ToS, so it never runs
  implicitly). Prefers a **live** scrape (Playwright + your `LINKEDIN_COOKIE`); falls
  back to parsing `Linkedin_Profile.pdf` in the repo root. Either way Gemini structures
  it into clean JSON (extract-only).

The scrapes reach the LLM through the **profile digest** — a deterministic ~2 KB
distillation (top repos with curation pins first, external merged-PR contributions with
sample titles, LinkedIn role one-liners) injected into every drafting prompt as evidence
for what to emphasize; `facts.json` remains the only source of claims. Inspect it with
`pnpm digest` (`--json` for the structured form).

`profile/sources.lock.json` records each source's last-scrape time and a **content
hash**: a source re-scrapes only when older than `SCRAPE_TTL_HOURS` (default 12) or
`--force`, and the JSON is rewritten only when its content actually changes — the hash
prevents needless churn. Edit the JSON by hand to correct anything; your edits persist
until a scrape changes that field. `pnpm sync` also re-baselines the file-drift
hashes so the tailor stops warning after you edit `facts.json`.

---

## One-time setup

1. **GitHub** — create a repo and push this project to `main`.
2. **Vercel** — sign in with GitHub and create a project from the repo. Then add three
   GitHub Actions **secrets** (Settings → Secrets and variables → Actions):
   - `VERCEL_TOKEN` — from Vercel → Account Settings → Tokens
   - `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` — run `vercel link` locally and read them
     from the generated `.vercel/project.json`
3. **Upstash Redis / Vercel KV** — in the Vercel dashboard, add a KV/Upstash store and
   connect it to the project. Vercel injects the credentials automatically (see below).

The counter is resilient: if the store isn't configured yet, the résumé still serves —
views simply aren't counted until it's connected.

### Environment variables

The function reads whichever pair your integration provides:

| Variable | Source |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash integration |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel KV |

Set both only if you want to override; either pair alone is enough.
