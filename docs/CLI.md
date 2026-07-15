# The `resume` CLI

One entrypoint (`apps/cli/src/main.ts`) for the whole résumé toolkit: tailor a
résumé to a job description, keep your GitHub/LinkedIn facts fresh, build the
canonical PDF, and run the guards that CI also runs.

Run it via the workspace scripts in [package.json](../package.json), or directly
with `pnpm --filter @resume/cli exec tsx src/main.ts <command>`.

```
pnpm resume            # interactive menu
pnpm resume <command>  # e.g. pnpm resume status
```

## Interactive menu

Running `resume` with no command (`pnpm resume`) opens a menu built with
`@clack/prompts` that walks you through the same five commands below —
useful when you don't remember the flags. Each action returns to the menu
until you choose Exit.

## Commands

### `chat` — conversational agent (every capability as a tool)

```
resume chat [--new]
```

Opens a streaming chat with the job-search agent (Mastra + Gemini/DeepSeek). It has all the
toolkit's capabilities as tools — scoring, tailoring, drafting/sending email, Wellfound notes,
syncing, building, updating facts, and more — and calls them for you. Text streams back; tool
calls and progress show as dim lines; `Ctrl+C` cancels the current turn without quitting.

Memory persists across sessions (libSQL under `.agent/`, gitignored): past threads, a
working-memory scratchpad (active applications, preferences), and semantic recall when a Gemini
key is set. By default it resumes your most recent thread; `--new` starts fresh.

Slash commands: `/help`, `/new`, `/threads` (list + switch), `/model` (switch the chat model
for this session), `/usage` (token usage, est. spend, context-window status), `/paste`
(multi-line JD), `/jd <file>` (attach a JD file to the next message), `/status`, `/facts`, `/exit`.

After every turn a dim status line reports the model, how full the context window is
(last prompt tokens / window), tokens moved (↑ in / ↓ out), and estimated spend for the
turn and the session. Prices are approximate public list prices for local display only —
not billing. `/model` only offers providers that have a key; switching keeps the current
thread and running usage totals.

Configure the agent model with `AGENT_PROVIDER` / `AGENT_MODEL` (see `.env.example`); it defaults
to the same provider chain as `tailor`. `/model` overrides both for the running session.

### `tailor` — JD → ATS-optimized PDF

```
resume tailor <path/to/jd.txt> --company "Acme AI" [--role "AI Engineer"] [--provider gemini|deepseek] [--model <model>]
resume tailor --jd "paste JD text..." --company "Acme AI"
```

| Flag | Required | Description |
|---|---|---|
| `<jd-file>` (positional) | one of this or `--jd` | path to a text file containing the job description |
| `--jd` | one of this or a positional | JD text inline instead of a file |
| `--company` (alias `--name`) | yes | company name; used for the output folder and filename |
| `--role` | no | override the role title; otherwise inferred by the LLM, then by regex from the JD, then falls back to "Software Engineer" |
| `--provider` | no | LLM provider id (`gemini`, `deepseek`, …); default from `LLM_PROVIDER`, else whichever key is set |
| `--model` | no | model override (default from the provider's `*_MODEL` env var, else its default) |

What it does, in order ([packages/core/src/tailor/service.ts](../packages/core/src/tailor/service.ts)):

1. Loads `profile/facts.json` and `resume.tex`.
2. Refreshes scraped sources (GitHub/LinkedIn) if stale — fails soft, falls back to cached data.
3. Warns if `profile/*.json` drifted since the last `sync` (fact base may be stale).
4. Extracts JD keywords and scores the current résumé against them.
5. Asks the configured LLM to rewrite the summary/subtitle from the verified fact base (never invents facts).
6. Resolves the output name/role and writes a tailored `.tex`.
7. Compiles the PDF and runs the same page-count/overfull-width guards as `check`; if a guard fails it re-asks the model for a tighter draft (up to 2 attempts).
8. Writes a `.report.md` next to the PDF with the score, rationale, and guard results.

Requires an LLM API key (`GEMINI_API_KEY` or `DEEPSEEK_API_KEY`) in `.env` — there is no offline mode for tailoring.

Output layout ([packages/core/src/naming.ts](../packages/core/src/naming.ts)):

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

Shows, at a glance ([apps/cli/src/commands/status.ts](../apps/cli/src/commands/status.ts)):
- **Environment** — which LLM providers have a key (and which is active), GitHub token set?, LinkedIn live-scrape readiness (cookie + Playwright).
- **LaTeX toolchain** — whether `latexmk` or a running Docker daemon is available to render.
- **Scraped sources** — GitHub/LinkedIn freshness and whether they've drifted since the last `sync`.
- **Canonical résumé** — whether `apps/web/assets/resume.pdf` is built, its size and age.
- **Tailored outputs** — the most recent tailored PDFs on disk.

### `build` — compile the canonical résumé

```
resume build
```

Thin wrapper over `apps/cli/src/build-pdf.ts`: compiles `resume.tex` →
`apps/web/assets/resume.pdf`, mirroring what CI does. Needs `latexmk` locally or
a running Docker daemon.

### `check` — run the guards

```
resume check [--source|--pdf|--width]
```

Thin wrapper over `apps/cli/src/check-resume.ts`. With no flag it runs every guard;
otherwise it scopes to one:

| Flag | Checks |
|---|---|
| `--source` | `resume.tex` structure (required sections, TAILOR anchors) |
| `--pdf` | the built PDF is exactly one page |
| `--width` | the LaTeX build log for overfull `\hbox` warnings (layout overflow) |

## Environment variables

Set these in `.env` at the repo root (copy from [.env.example](../.env.example); `.env` is gitignored):

| Variable | Required | Purpose |
|---|---|---|
| `LLM_PROVIDER` | no | default provider id (`gemini` / `deepseek`); else whichever key is set (Gemini first) |
| `GEMINI_API_KEY` | one LLM key, for `tailor` | Google Gemini API key |
| `GEMINI_MODEL` | no | Gemini model override, default `gemini-2.5-flash` |
| `DEEPSEEK_API_KEY` | one LLM key, for `tailor` | DeepSeek API key (OpenAI-compatible) |
| `DEEPSEEK_MODEL` | no | DeepSeek model override, default `deepseek-chat` |
| `GITHUB_TOKEN` | no | raises the GitHub API rate limit for `sync`; public scrape works without it |
| `SCRAPE_TTL_HOURS` | no | hours before a scraped source is considered stale (default 12) |
| `LINKEDIN_COOKIE` | no | `li_at` session cookie to enable live LinkedIn scraping via Playwright; without it, `sync` falls back to parsing `Linkedin_Profile.pdf` in the repo root |

## Related workspace scripts

`build`/`check` above are thin wrappers; these run the same underlying scripts directly:

```
pnpm build:pdf     # apps/cli/src/build-pdf.ts
pnpm check         # apps/cli/src/check-resume.ts (all guards)
pnpm --filter @resume/cli check:source  # --source
pnpm --filter @resume/cli check:pdf     # --pdf
pnpm --filter @resume/cli check:width   # --log
pnpm verify        # build:pdf then check
```

## Adding an LLM provider

Because the providers sit behind a registry, adding one is two steps:

1. Write `packages/core/src/llm/providers/<name>.ts` exporting an `LlmProviderFactory`
   (`id`, `label`, `apiKeyEnv`, `modelEnv`, `defaultModel`, and `create()`).
2. Register it in the composition root: `apps/cli/src/container.ts` → `.register(<name>Factory)`.

No changes to the tailor pipeline, scrapers, `status`, or config are needed.

## See also

- [apps/cli/src/main.ts](../apps/cli/src/main.ts) — entrypoint and command dispatch
- [apps/cli/src/container.ts](../apps/cli/src/container.ts) — composition root (adapters + provider registry)
- [apps/cli/src/args.ts](../apps/cli/src/args.ts) — argv parsing rules (flag vs. positional)
- The `resume-tailor` and `resume-ats` skills for the tailoring pipeline and ATS keyword scoring in more depth
