# The `resume` CLI

One entrypoint (`scripts/cli.ts`) for the whole résumé toolkit: tailor a résumé
to a job description, keep your GitHub/LinkedIn facts fresh, build the
canonical PDF, and run the guards that CI also runs.

Run it via the npm scripts in [package.json](../package.json), or directly
with `tsx scripts/cli.ts <command>`.

```
npm run resume            # interactive menu
npm run resume <command>  # same as: npx tsx scripts/cli.ts <command>
```

## Interactive menu

Running `resume` with no command (`npm run resume`) opens a menu built with
`@clack/prompts` that walks you through the same five commands below —
useful when you don't remember the flags. Each action returns to the menu
until you choose Exit.

## Commands

### `tailor` — JD → ATS-optimized PDF

```
resume tailor <path/to/jd.txt> --company "Acme AI" [--role "AI Engineer"] [--model gemini-2.5-flash]
resume tailor --jd "paste JD text..." --company "Acme AI"
```

| Flag | Required | Description |
|---|---|---|
| `<jd-file>` (positional) | one of this or `--jd` | path to a text file containing the job description |
| `--jd` | one of this or a positional | JD text inline instead of a file |
| `--company` (alias `--name`) | yes | company name; used for the output folder and filename |
| `--role` | no | override the role title; otherwise inferred by Gemini, then by regex from the JD, then falls back to "Software Engineer" |
| `--model` | no | Gemini model override (default from `GEMINI_MODEL`, else `gemini-2.5-flash`) |

What it does, in order ([scripts/commands/tailor.ts](../scripts/commands/tailor.ts)):

1. Loads `profile/facts.json` and `resume.tex`.
2. Refreshes scraped sources (GitHub/LinkedIn) if stale — fails soft, falls back to cached data.
3. Warns if `profile/*.json` drifted since the last `sync` (fact base may be stale).
4. Extracts JD keywords and scores the current résumé against them.
5. Asks Gemini to rewrite the summary/subtitle from the verified fact base (never invents facts).
6. Resolves the output name/role and writes a tailored `.tex`.
7. Compiles the PDF and runs the same page-count/overfull-width guards as `check`.
8. Writes a `.report.md` next to the PDF with the score, rationale, and guard results.

Requires `GEMINI_API_KEY` in `.env` — there is no offline mode for tailoring.

Output layout ([scripts/lib/naming.ts](../scripts/lib/naming.ts)):

```
tailored/<company_slug>/<Full Name> - <Role>.pdf
tailored/<company_slug>/<Full Name> - <Role>.tex
tailored/<company_slug>/<Full Name> - <Role>.report.md
```

### `sync` — refresh scraped profile sources

```
resume sync [--force]
```

Re-scrapes GitHub and LinkedIn into `profile/github.json` / `profile/linkedin.json`
when stale (see `SCRAPE_TTL_HOURS`), then re-baselines the drift hashes in
`profile/sources.lock.json` so `tailor` won't nag about stale facts afterward.
`--force` ignores the freshness TTL and re-scrapes unconditionally.

Manual edits to `profile/github.json` / `profile/linkedin.json` persist until
the next scrape changes that specific field.

### `status` — one-screen health check

```
resume status
```

Shows, at a glance ([scripts/commands/status.ts](../scripts/commands/status.ts)):
- **Environment** — Gemini key set?, GitHub token set?, LinkedIn live-scrape readiness (cookie + Playwright).
- **LaTeX toolchain** — whether `latexmk` or a running Docker daemon is available to render.
- **Scraped sources** — GitHub/LinkedIn freshness and whether they've drifted since the last `sync`.
- **Canonical résumé** — whether `assets/resume.pdf` is built, its size and age.
- **Tailored outputs** — the most recent tailored PDFs on disk.

### `build` — compile the canonical résumé

```
resume build
```

Thin wrapper over `scripts/build-pdf.ts`: compiles `resume.tex` → `assets/resume.pdf`,
mirroring what CI does. Needs `latexmk` locally or a running Docker daemon.

### `check` — run the guards

```
resume check [--source|--pdf|--width]
```

Thin wrapper over `scripts/check-resume.ts`. With no flag it runs every guard;
otherwise it scopes to one:

| Flag | Checks |
|---|---|
| `--source` | `resume.tex` structure (required sections, TAILOR anchors) |
| `--pdf` | the built PDF is exactly one page |
| `--width` | the LaTeX build log for overfull `\hbox` warnings (layout overflow) |

## Environment variables

Set these in `.env` (copy from [.env.example](../.env.example); `.env` is gitignored):

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | yes, for `tailor` | Google Gemini API key |
| `GEMINI_MODEL` | no | model override, default `gemini-2.5-flash` |
| `GITHUB_TOKEN` | no | raises the GitHub API rate limit for `sync`; public scrape works without it |
| `SCRAPE_TTL_HOURS` | no | hours before a scraped source is considered stale (default 12) |
| `LINKEDIN_COOKIE` | no | `li_at` session cookie to enable live LinkedIn scraping via Playwright; without it, `sync` falls back to parsing `Linkedin_Profile.pdf` in the repo root |

## Related npm scripts

`build`/`check` above are thin wrappers; these run the same underlying scripts directly:

```
npm run build:pdf     # scripts/build-pdf.ts
npm run check         # scripts/check-resume.ts (all guards)
npm run check:source  # --source
npm run check:pdf     # --pdf
npm run check:width   # --log
npm run verify        # build:pdf then check
```

## See also

- [scripts/cli.ts](../scripts/cli.ts) — entrypoint and command dispatch
- [scripts/lib/args.ts](../scripts/lib/args.ts) — argv parsing rules (flag vs. positional)
- The `resume-tailor` and `resume-ats` skills for the tailoring pipeline and ATS keyword scoring in more depth
