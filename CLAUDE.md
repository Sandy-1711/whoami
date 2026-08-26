# ResumeGit

A résumé toolkit for one person (Sandeep). A hand-verified fact base grounds every generated
artifact; the résumé is structured data that renders to LaTeX and compiles to a PDF served from
Vercel. Anything that needs a model is the
agent's — `resume chat` or the MCP server, both wiring the same tool set. The rest of the `resume`
CLI is the operator surface: the toolchain, the free deterministic reads, and sending a draft that
already exists.

## Active work — read this first

Hardening work is in progress on the **`hardening`** branch, not `main`. Start with
**[docs/ROADMAP.md](docs/ROADMAP.md)** — it carries current status and per-phase what/why/how.
Then [docs/DECISIONS.md](docs/DECISIONS.md) for why things are the way they are, and
[docs/CONVENTIONS.md](docs/CONVENTIONS.md) before writing any code.

```sh
git log --oneline main..hardening    # what has landed
```

## Orientation

Reading order for someone new to the repo:

1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — package graph and how the pieces connect.
2. [docs/CLI.md](docs/CLI.md) — every command and what it does.
3. `profile/facts.json` — the fact base. **The only source of claims.** If it is not in here, it
   may not be asserted about the candidate.
4. `profile/resume.json` — the résumé itself. `resume.tex` is rendered from it; edit the JSON, not
   the LaTeX.
5. `packages/core/src/tailor/service.ts` — the pipeline that matters most.
6. `packages/agent/src/agent.ts` — `assembleTools` is the single source of truth for what tools
   exist; chat and MCP both wire exactly that set.

```
apps/cli       the `resume` command — menu, operator commands, chat REPL, MCP server
apps/web       deployed Vercel functions serving the published PDF (unrelated to the toolkit)
packages/core  the domain: tailoring, email, outreach, scraping, guards
packages/agent Mastra agent: tools, memory, instructions, MCP server
packages/llm   the only place a model is called
```

Config flows one way: `apps/cli/src/adapters/config.ts` builds a typed `AppConfig`; nothing in
`packages/` reads `process.env`.

## Commands

```sh
pnpm test          # all packages
pnpm typecheck     # all packages
pnpm resume        # interactive menu
pnpm status        # keys, toolchain, source freshness, outputs — free, no LLM
pnpm score <jd>    # deterministic JD fit score — free, no LLM
pnpm digest        # ranked GitHub/LinkedIn evidence — free, no LLM
pnpm send          # mail a saved draft verbatim — free, no LLM
pnpm verify        # build the PDF, then run the guards
```

Rendering needs Docker running (or a local `latexmk`). `pnpm status` says which.

## Costs

`pnpm chat` and the agent's drafting tools (`tailor_plan`, `tailor_render`,
`draft_application_email`, `outreach_message`) spend real API credits. Warn before running them,
and never run one to "check something works" — use `status`, `score`, `digest`, or the fake
gateway in `@resume/llm/testing` instead. Every other command is free by construction: no command
calls a model any more.

`.claude/skills/` holds six skills that do job-search work in-session with no API spend
(`job-copilot`, `resume-ats`, `resume-facts`, `resume-latex`, `resume-outreach`, `resume-tailor`).
Prefer them over the paid pipelines when the user wants something drafted.

## Ground rules

Full detail in [docs/CONVENTIONS.md](docs/CONVENTIONS.md). The short version:

- Few comments — only where the code cannot say it itself. Keep JSDoc on exported API. Never
  record history ("used to", "previously").
- One concern per commit, staging only that concern's files. Explain *why* in the body.
- The repo is worked in parallel from another terminal: re-check `git rev-parse --abbrev-ref HEAD`
  before committing.
