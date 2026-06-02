# Resume CI/CD

[![Build & Deploy](https://github.com/Sandy-1711/whoami/actions/workflows/build-deploy.yml/badge.svg)](https://github.com/Sandy-1711/whoami/actions/workflows/build-deploy.yml)
[![Last updated](https://img.shields.io/github/last-commit/Sandy-1711/whoami?label=last%20updated)](https://github.com/Sandy-1711/whoami/commits/main)
[![Resume views](https://img.shields.io/endpoint?url=https%3A%2F%2Fiamsandeep.vercel.app%2Fapi%2Fbadge)](https://iamsandeep.vercel.app)

My résumé, written in **LaTeX**, compiled to **PDF** by **GitHub Actions**, and served as a
**view-counted PDF** on **Vercel**. Every edit is tracked in git; every push to `main`
recompiles and redeploys the live link.

**Live:** https://iamsandeep.vercel.app

## How it works

```
 resume.tex  ──git push──►  GitHub repo
     │
     ▼  GitHub Actions (CI)  — .github/workflows/build-deploy.yml
  1. compile resume.tex → resume.pdf      (xu-cheng/latex-action, full TeXLive)
  2. stage it at assets/resume.pdf
  3. deploy to Vercel                      (vercel CLI + token)
     │
     ▼  Vercel (CD / hosting)
  /  and  /resume.pdf  → api/resume  (serverless function):
        a. INCR a view counter in Vercel KV (Upstash Redis)
        b. stream resume.pdf   (inline;  ?download=1 → attachment)
  /api/stats → { "views": N }     /api/badge → shields.io endpoint JSON
```

## Edit the resume

Edit `resume.tex`, then commit and push to `main`:

```bash
git add resume.tex
git commit -m "Update resume"
git push
```

CI recompiles and redeploys automatically — no manual build needed.

## Endpoints

| Path | What it returns |
| --- | --- |
| `/` and `/resume.pdf` | the résumé PDF, shown inline in the browser |
| `/?download=1` | the same PDF as a download (`Content-Disposition: attachment`) |
| `/api/stats` | `{ "views": N }` |
| `/api/badge` | shields.io endpoint JSON powering the "resume views" badge |

## Local development

You **don't** need LaTeX installed locally — CI builds the PDF. To preview the functions:

```bash
npm install
# put any PDF at assets/resume.pdf as a stand-in (CI generates the real one)
vercel dev          # → http://localhost:3000
```

To compile the LaTeX locally (optional), install TeXLive/MiKTeX, then:

```bash
npm run build:pdf   # latexmk -pdf resume.tex  →  assets/resume.pdf
```

## Structure check

A dependency-light checker validates the résumé's structure so a broken layout
never ships. It runs in two phases:

- **Source** (`resume.tex`) — required sections present, balanced
  environments/braces/list-macros, contact links intact, no empty bullets. Pure
  Node, no LaTeX needed.
- **PDF** (`assets/resume.pdf`) — exactly one page, all sections survive into the
  rendered text, contact email present. Uses [`unpdf`](https://github.com/unjs/unpdf).

```bash
npm run check          # source + PDF (PDF auto-skipped if not built yet)
npm run check:source   # source only
npm run check:pdf      # PDF only (needs assets/resume.pdf)
```

It runs automatically in two places:

- **Pre-commit hook** (`.githooks/pre-commit`) — runs the source check whenever a
  commit touches `resume.tex`. Wired by the `prepare` script on `npm install`
  (`git config core.hooksPath .githooks`); bypass once with `git commit --no-verify`.
- **CI** — the source check gates the build before compiling, and the PDF check
  runs on the freshly compiled PDF before deploy.

## One-time setup

1. **GitHub** — create a repo and push this project to `main`.
2. **Vercel** — sign in with GitHub and create a project from the repo. Then add three
   GitHub Actions **secrets** (Settings → Secrets and variables → Actions):
   - `VERCEL_TOKEN` — from Vercel → Account Settings → Tokens
   - `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` — run `vercel link` locally and read
     them from the generated `.vercel/project.json`
3. **Vercel KV (Upstash Redis)** — in the Vercel dashboard, add a KV/Upstash store and
   connect it to the project. Vercel injects `UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_*`) automatically. If your integration uses
   the `KV_REST_API_*` names, either alias them or adjust the `Redis` init in `api/*.js`.

The counter is resilient: if the KV store isn't configured yet, the résumé still serves —
views simply aren't counted until the store is connected.
