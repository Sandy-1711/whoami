# Architecture

Sections are tagged **[built]** or **[planned — Phase N]**. A planned section describes a design
that does not exist on disk yet; check [ROADMAP.md](ROADMAP.md) for its current status before
trusting it.

## Package graph [built]

```
apps/cli      ── the `resume` command: interactive menu, direct commands, chat REPL, MCP server
apps/studio   ── local web studio: Hono server + Vite React SPA
apps/web      ── deployed Vercel functions serving the published PDF     (untouched)

packages/agent ── Mastra agent: tools, memory, instructions, MCP server
packages/core  ── the domain: tailoring, email, outreach, scraping, guards, résumé rendering
packages/llm   ── the only place a model is called
```

Dependency direction: `apps/*` → `packages/agent` → `packages/core` → `packages/llm`.
Nothing in `packages/` reads `process.env`; config arrives as a typed `AppConfig` built once in
`apps/cli/src/adapters/config.ts`.

## Composition root [built]

`apps/cli/src/container.ts` builds the `Cli` container — config, LaTeX compiler, PDF inspector,
presenter, mailer. Every front end derives its deps from it:

- **CLI commands** take the `Cli` directly.
- **Chat** builds an `AgentDeps` from it, adding a terminal confirm gate.
- **MCP** builds an `AgentDeps` from it, adding a stderr presenter.
- **Studio** builds an `AgentDeps` per turn, adding an SSE presenter and gates that round-trip
  to the browser. Per turn, not per server, because the presenter and the gates belong to one
  stream — a confirm modal has to appear in the tab that asked for it. Memory and the tracing
  pipeline are the studio's, built once and passed in, so a rebuild costs an `Agent` object.

`buildCli()` is reachable because `@resume/cli` declares a package entry (`apps/cli/src/index.ts`)
alongside its bin. That entry is for consumers; `main.ts` imports the container directly.

`assembleTools(deps)` in `packages/agent/src/agent.ts` is the single source of truth for what tools
exist. All three front ends wire exactly that set, so they cannot drift apart.

## The LLM path [built]

One gateway, `packages/llm`. The hand-rolled `fetch` providers and the `LlmProvider` port that
preceded it are deleted.

```
prompts.ts (text + Zod schema)
        │
        ▼
packages/llm/generate.ts   createLlm(config, defaults?) -> Llm
  ├── models.ts    Gemini first, DeepSeek secondary
  ├── timeout      AbortSignal.timeout(), LLM_TIMEOUT_MS or 90s
  ├── errors.ts    LlmError { kind, retryable, provider, model, cause }
  └── retry        the AI SDK's own — it backs off and honours retry-after
        │
        ▼
  validated, typed object  (generateObject + Zod)
```

`Llm` is injected like `LatexCompiler` and `Mailer` are, so any service can be driven end to end
against `createFakeLlm` from `@resume/llm/testing` with no network and no spend. The fake applies
the request schema, so it fails the way production does.

`generateObject` validates the model's output against the schema, so a missing field fails loudly
instead of reaching LaTeX as `undefined`.

Services surface `LlmError.kind` and the original message. Nothing flattens a provider error into
a generic sentence — under MCP that made every failure look identical, because the real message went
to stderr where the client discards it.

## Tracing [built]

One OTel tracer, exported to a self-hosted Langfuse. The Mastra agent attaches observability at the
`Mastra` container level; `packages/llm` emits spans on the same tracer, so a chat turn that
triggers a tailor run appears as one trace with nested generations.

Disabled by default in the absence of `LANGFUSE_ENABLED`. An observability outage must never fail a
run.

## The résumé [built]

`profile/resume.json` is the source of truth. `resume.tex` is a build artifact — rendered by both
build paths before they compile, and checked by the source guard for still matching the document.

```
profile/resume.json  ── name, subtitle, contacts, summary, experience[], projects[], skills[], education[]
        │                every entry and bullet carries a stable id
        │
        ▼  packages/core/src/resume/render.ts
   preamble.ts + generated body  →  resume.tex  →  PDF
```

Prose fields use a **restricted markup**: `**bold**`, `[label](url)` and `` `code` ``, nothing else.
The renderer consumes the markers, escapes everything else, and only then emits LaTeX — so copy that
arrives with a stray `&`, or with LaTeX in it, prints as text. `extract.ts` reads a rendered résumé
back into data, which is how the hand-written source migrated and how a `.tex` edit can still get in.

Tailoring produces a `ResumeEdit` addressing bullets by `id`. Every rewritten line is checked by
`unbackedClaims` (`packages/core/src/profile/claims.ts`) against the fact base and the line it
replaces; anything else it claims is dropped, the original text kept, and the revert reported. That
is what makes "the model may rewrite everything" safe.

The score is measured on the document that rendered, not projected before the model runs. The
projection is kept beside it and printed when the two differ — that gap says the rewrite left
something on the table.

## The studio [built]

One process on one port (`127.0.0.1:4321`). `/api` is Hono over the container above; everything
else is a React SPA served by **Vite in middleware mode**, so there is no build step between
editing a component and reloading it.

```
apps/studio/src/
  server/   Hono routes, the SSE turn, the browser-backed gates    NodeNext
  web/      the SPA                                                bundler + JSX
  shared/   the wire format both halves import                     both
```

The two halves resolve modules differently and spell the same import differently
(`'../shared/events.js'` on the server, `'../shared/events'` in the SPA). `typecheck` runs both
tsconfigs.

**Approvals over the wire.** `ConfirmGate` keeps its Phase 2 shape — a `ConfirmRequest` of resolved
values, not a sentence about them. The request goes out on the turn's SSE stream, the modal renders
those fields, and the browser's POST settles the promise the tool is awaiting. Every path out of the
registry resolves, and everything that is not an answer means refused: a timeout, a closed tab, a
dead stream. `ask_user` is the same mechanism except that going unanswered throws, so the model
learns nobody answered rather than receiving blanks it would treat as chosen.

Closing the stream is how the browser cancels; the disconnect aborts the run as well as settling
the parked gates.

This is the only front end where this codebase both shows the gate and takes the answer. Chat
prompts a terminal; MCP delegates to the client's approval UI.

## Grounding [built]

Two files, different jobs:

- `profile/facts.json` — the **only** source of claims. If it is not here, it may not be asserted.
- The profile digest (`packages/core/src/profile/digest.ts`) — a deterministic, LLM-free ranking of
  scraped GitHub/LinkedIn evidence. It steers *which* true facts to emphasize and lets copy cite
  real repos and PRs. It grants no new claims.

`profile/curation.json` pins and bans repos before they reach the digest. `profile/sources.lock.json`
carries scrape freshness and file-drift hashes.

## Guards [built]

`packages/core/src/check/` — source (structure, plus `resume.tex` still being what
`profile/resume.json` renders to; no compile needed), rendered-PDF structure, and width (overfull
lines from the LaTeX log). CI runs the source check before compiling and the PDF check after.
`.githooks/pre-commit` runs the source check when either résumé file is staged.

The tailor pipeline runs the page and width guards after every render and re-asks the model for
tighter copy when they fail.
