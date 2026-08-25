# Architecture

Sections are tagged **[built]** or **[planned — Phase N]**. A planned section describes a design
that does not exist on disk yet; check [ROADMAP.md](ROADMAP.md) for its current status before
trusting it.

## Package graph [built, except apps/studio]

```
apps/cli      ── the `resume` command: interactive menu, direct commands, chat REPL, MCP server
apps/studio   ── local web studio: Hono server + Vite React SPA   [planned — Phase 4]
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
- **Studio** (Phase 4) builds an `AgentDeps` from it, adding an SSE presenter and a
  confirm gate that round-trips to the browser.

`assembleTools(deps)` in `packages/agent/src/agent.ts` is the single source of truth for what tools
exist. Chat and MCP both wire exactly that set, so the front ends cannot drift apart. The studio
wires the same.

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

## The résumé [planned — Phase 3]

`profile/resume.json` is the source of truth. `resume.tex` becomes a build artifact.

```
profile/resume.json  ── identity, subtitle, summary, experience[], projects[], skills[], education[]
        │                every entry carries a stable id
        │
        ▼  packages/core/src/resume/render.ts
   preamble partial + generated body  →  resume.tex  →  PDF
```

Prose fields use a **restricted markup**: `**bold**` and `[label](url)`, nothing else. The renderer
escapes with `latexEscape` first, then converts the two markers. The model never writes LaTeX.

Tailoring produces a `ResumeEdit` addressing bullets by `id`. Every rewritten bullet is checked
against `factIndex(facts)` before render; unbacked keywords revert the bullet and are reported. That
is what makes "the model may rewrite everything" safe.

The score is measured after render (`classify` + `scoreResume` over `latexToPlainText` of the
output), not projected before the model runs.

## Grounding [built]

Two files, different jobs:

- `profile/facts.json` — the **only** source of claims. If it is not here, it may not be asserted.
- The profile digest (`packages/core/src/profile/digest.ts`) — a deterministic, LLM-free ranking of
  scraped GitHub/LinkedIn evidence. It steers *which* true facts to emphasize and lets copy cite
  real repos and PRs. It grants no new claims.

`profile/curation.json` pins and bans repos before they reach the digest. `profile/sources.lock.json`
carries scrape freshness and file-drift hashes.

## Guards [built]

`packages/core/src/check/` — source structure (no compile needed), rendered-PDF structure, and
width (overfull lines from the LaTeX log). CI runs the source check before compiling and the PDF
check after. `.githooks/pre-commit` runs the source check when `resume.tex` is staged.

The tailor pipeline runs the page and width guards after every render and re-asks the model for
tighter copy when they fail.
