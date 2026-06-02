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
   3. stage it at assets/resume.pdf
   4. check the compiled PDF structure                (1 page, sections present, contact intact)
   5. deploy to Vercel                                (vercel CLI + token)
     │
     ▼  Vercel (hosting / serverless)
   /  and  /resume.pdf  → api/resume.js:
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
├── api/
│   ├── resume.js               # serves the PDF and counts the view
│   ├── stats.js                # GET → { "views": N }
│   └── badge.js                # GET → shields.io endpoint JSON
├── lib/
│   └── redis.js                # KV/Upstash client factory (null-safe if unconfigured)
├── scripts/
│   ├── check-resume.js         # structure-check CLI (source + PDF)
│   └── lib/
│       ├── check-source.js     # validates resume.tex without compiling
│       └── extract-pdf.js      # PDF → { text, totalPages } via unpdf (reusable seam)
├── assets/
│   └── resume.pdf              # compiled by CI — gitignored, never committed
├── .githooks/
│   └── pre-commit              # runs the source check when resume.tex is committed
├── .github/workflows/
│   └── build-deploy.yml        # CI/CD: check → compile → check → deploy
├── vercel.json                 # URL rewrites + bundles the PDF into the function
└── package.json
```

---

## How it works

### The request lifecycle (`api/resume.js`)

1. On cold start, the function reads `assets/resume.pdf` from disk **once** and keeps
   it in memory.
2. On each request it issues an `INCR resume:views` to the KV store, then streams the
   PDF. If the counter ever fails, the PDF is **still served** — serving the résumé
   always wins over counting it.
3. `Cache-Control: no-store` is set so the CDN doesn't cache the response — every open
   re-invokes the function and is counted.
4. `?download=1` switches `Content-Disposition` from `inline` to `attachment`, and the
   file saves under a human-readable name (`Sandeep Singh - AI Engineer.pdf`) via both
   the quoted `filename` and the RFC 5987 `filename*` form.

### The CI/CD pipeline (`.github/workflows/build-deploy.yml`)

On every push to `main` (or manual `workflow_dispatch`):

1. **Setup + install** Node and dependencies.
2. **Source check** — `node scripts/check-resume.js --source` (fails fast on broken
   LaTeX before spending time compiling).
3. **Compile** `resume.tex` → `resume.pdf` with full TeXLive.
4. **Stage** the PDF at `assets/resume.pdf` and upload it as a build artifact.
5. **PDF check** — `node scripts/check-resume.js --pdf` (verifies the rendered output).
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
| `/` and `/resume.pdf` | the résumé PDF, shown inline in the browser |
| `/?download=1` | the same PDF as a download (`Sandeep Singh - AI Engineer.pdf`) |
| `/api/stats` | `{ "views": N }` |
| `/api/badge` | shields.io endpoint JSON powering the "resume views" badge |

---

## Structure check

A dependency-light checker validates the résumé's structure so a broken layout never
ships. It runs in two phases:

- **Source** (`resume.tex`) — required sections present, balanced
  environments / braces / list-macros, contact links intact, no empty bullets. Pure
  Node, **no LaTeX needed**.
- **PDF** (`assets/resume.pdf`) — exactly one page, all sections survive into the
  rendered text, contact email present. Uses [`unpdf`](https://github.com/unjs/unpdf)
  (a Node-friendly build of pdf.js).

```bash
npm run check          # source + PDF (PDF auto-skipped if not built yet)
npm run check:source   # source only
npm run check:pdf      # PDF only (needs assets/resume.pdf)
```

It runs automatically in two places:

- **Pre-commit hook** (`.githooks/pre-commit`) — runs the source check whenever a
  commit touches `resume.tex`. Wired by the `prepare` script on `npm install`
  (`git config core.hooksPath .githooks`); bypass once with `git commit --no-verify`.
- **CI** — the source check gates the build before compiling, and the PDF check runs
  on the freshly compiled PDF before deploy.

The PDF text extraction lives in `scripts/lib/extract-pdf.js` as a reusable seam, so
the same extraction can feed future tooling (e.g. ATS scoring).

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
npm install                       # installs deps and wires the pre-commit hook
# put any PDF at assets/resume.pdf as a stand-in (CI generates the real one)
npm run dev                       # vercel dev → http://localhost:3000
```

To compile the LaTeX locally (optional), install TeXLive/MiKTeX, then:

```bash
npm run build:pdf                 # latexmk -pdf resume.tex → assets/resume.pdf
npm run check                     # validate source + the compiled PDF
```

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
