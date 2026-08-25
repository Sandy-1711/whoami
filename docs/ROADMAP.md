# Roadmap

**Read this first.** It is the handoff file: what is being built, what is done, and what comes
next. Update it in the same session that changes code — a phase is not finished until its box is
ticked here.

Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) (target design),
[DECISIONS.md](DECISIONS.md) (choices and why), [CONVENTIONS.md](CONVENTIONS.md) (how to write the
code).

## Status

| Phase | What | State |
| --- | --- | --- |
| 0 | Handoff docs | in progress |
| 1 | One LLM path, instrumented | not started |
| 2 | Flexible tools, unconfusing MCP | not started |
| 3 | Résumé as structured data | not started |
| 4 | Web studio | not started |
| 5 | Formatter, linter, comment pass | not started |
| 6 | Deferred work | not started |

Work stays **uncommitted** for review unless commits are explicitly requested.

---

## Why this work exists

The ports-and-adapters structure is sound and the test suite passes. The problems are in the LLM
layer, the tool surface, and the total absence of runtime visibility:

- Nothing logs a prompt, response, token count, latency, or cost. Seeing what reaches a model
  currently means dumping a rendered prompt to a scratch file by hand.
- Two parallel LLM stacks: hand-rolled `fetch` providers in `packages/core/src/llm/` for the
  pipelines, Vercel AI SDK via Mastra for chat.
- No timeout or retry on any network call. A 429 kills a run after the source refresh was already
  paid for.
- LLM output is never validated. A missing field flows into LaTeX as `undefined`.
- Real provider errors get replaced by a generic sentence in `tailor/service.ts` before anyone can
  read them, and under MCP the real message is written to stderr, which the client discards.
- Every JD-taking tool demands the full JD text inline — no file path, no URL.
- Tailoring rewrites two lines. Experience and project bullets are identical across every company
  in `tailored/`.
- The reported ATS "after" score is a projection computed before the model runs, never measured.
- The fact base is truncated mid-string by a blind `.slice()`, and `headline_metrics` never reaches
  the model at all.

---

## Phase 0 — Handoff docs

**What:** `docs/ROADMAP.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `CONVENTIONS.md`.

**Why:** the work spans several sessions. A new chat needs to resume without re-deriving the whole
codebase.

**How:** this file carries status and per-phase what/why/how; the others carry the stable
background. Keep them short enough that reading all four is cheap.

- [ ] Four docs written

---

## Phase 1 — One LLM path, instrumented

**What:** a new `@resume/llm` package that is the only place any model is called, with Langfuse
traces underneath it and a fake model for offline tests.

**Why:** the two-stack split doubles the failure surface and makes tracing impossible to do once.
Everything downstream is easier to debug once traces exist, which is why this goes first.

**How:**

- `packages/llm/src/models.ts` — Gemini-first resolution from `AppConfig`, DeepSeek secondary.
  Absorbs `resolveAgentModel`/`resolveTitleModel` from `packages/agent/src/model.ts`.
- `packages/llm/src/generate.ts` — AI SDK `generateObject` with a Zod schema, plus timeout
  (`AbortSignal.timeout()`), retry with backoff, and span emission.
- `packages/llm/src/errors.ts` — `LlmError { kind, retryable, provider, model, cause }`,
  `kind` ∈ `rate_limit | auth | timeout | schema | safety | server | unknown`. Retry on
  `rate_limit | server | timeout`, honour `Retry-After`, cap at 3 attempts.
- `packages/llm/src/tracing.ts` — OTel tracer wired to the Langfuse exporter. **No-op when
  `LANGFUSE_ENABLED` is unset or Langfuse is down; never fail a run.**
- Delete `packages/core/src/llm/` and `packages/core/src/ports/llm.ts`.
- `packages/core/src/prompts.ts` — `*_SCHEMA` constants become Zod schemas; most `map*Response`
  functions disappear because `generateObject` returns validated objects. Keep `clampBio`.
- `serializeFacts(facts, budget)` replaces every blind `JSON.stringify(facts).slice(0, N)`. Drops
  whole sections in priority order, never emits malformed JSON, warns naming what was dropped.
  Tuning the priority order is Phase 6, not now.
- `infra/langfuse/docker-compose.yml` — self-hosted stack; `pnpm langfuse:up` / `langfuse:down`.
- Introduce a `Mastra` instance in `packages/agent/` — observability attaches at container level,
  and today `agent.ts` constructs a bare `new Agent(...)`.
- `packages/llm/src/testing/fake.ts` and `packages/core/src/testing/` (fake LaTeX compiler and PDF
  inspector) so a full tailor run is testable with no Docker and no spend.
- `.env`: default to Gemini, drop the unused `OPENROUTER_API_KEY`.

**Verify:** `pnpm test` (including a new offline end-to-end tailor test); `pnpm typecheck`; one
real tailor run appears as a trace at `localhost:3000` with prompt, response, tokens, cost; a run
still completes with `LANGFUSE_ENABLED` unset; a bad `GEMINI_API_KEY` produces an error that names
the auth failure.

- [ ] `@resume/llm` package
- [ ] Prompts on Zod + `serializeFacts`
- [ ] Langfuse self-hosted and wired
- [ ] Fake model + offline end-to-end tailor test
- [ ] Config cleanup

---

## Phase 2 — Flexible tools, unconfusing MCP

**What:** tools that accept real-world inputs, and an MCP surface an external agent can reason
about without getting lost.

**Why:** "sometimes MCP fails" traces to three things — long tool calls near the client timeout,
a three-process launch chain, and errors that all look the same. "Tools are too rigid" traces to
`jd: z.string()` everywhere.

**How:**

- `packages/agent/src/tools/inputs.ts` — one resolver taking `{ jd?, jdPath?, jdUrl? }`, applied
  to every JD-taking tool. URLs fetched with a timeout and size cap.
- `send_application_email` falls back to `tailored/<company>/application-email.txt` when the
  session `Map` is empty. `EmailService.draft` already writes that file.
- `update_facts` accepts an array of edits applied atomically.
- `check_resume` takes a `scope` enum; align the CLI's `--width`/`--log` naming with it.
- `apps/cli/src/args.ts` — `opt()` must reject a value that looks like a flag.
- Consolidate overlapping tools; where two must coexist, each description says **when not to use
  it** and names the other.
- Split `tailor_resume` into `tailor_plan` (fast, no Docker) and `tailor_render` (compile +
  guards), so no MCP call sits near a client timeout. Keep a wrapper for the CLI.
- Tool results carry `nextSteps`. The `MCPServer` description states the typical flow.
- Build `apps/cli/dist/`; `.mcp.json` invokes `node apps/cli/dist/main.js mcp` directly.
- Outward-facing tools require an explicit `confirm: true` argument. `runMcp` sets
  `confirm: async () => true` and delegates entirely to the MCP client's prompt — one "always
  allow" and mail goes out unchecked.

**Verify:** score a JD by path without pasting; restart the MCP server and send a draft from a
previous session; call `mcp__resume__profile_status` and `mcp__resume__score_jd` from Claude Code
after the `.mcp.json` switch.

- [ ] Input resolver applied everywhere
- [ ] Tool surface consolidated + `nextSteps`
- [ ] `tailor_plan` / `tailor_render` split
- [ ] `dist` build + `.mcp.json` switch
- [ ] Explicit confirm argument

---

## Phase 3 — Résumé as structured data

**What:** `profile/resume.json` becomes the source of truth; `resume.tex` becomes a rendered
artifact. Tailoring can then rewrite every section.

**Why:** tailoring two lines is not tailoring, and letting a model write LaTeX directly is how the
output breaks. Structured data removes both problems at once.

**How:**

- `packages/core/src/resume/schema.ts` — Zod schema (identity, subtitle, summary, experience,
  projects, skills, education; stable `id` on each entry).
- **Restricted markup** in all prose: `**bold**` and `[label](url)`, nothing else. The renderer
  escapes via the existing `latexEscape` first, then converts the two markers. The model never
  emits LaTeX. `boldify`'s first-occurrence heuristic retires.
- `packages/core/src/resume/render.ts` — JSON → `.tex`, composing the preamble/macros partial
  (verbatim from current `resume.tex` lines 1–68) with a generated body.
- `packages/core/src/resume/extract.ts` — one-time `resume.tex` → `resume.json` migration.
- `TailorService` produces a validated `ResumeEdit` addressing bullets by `id`.
- Every rewritten bullet is checked against `factIndex(facts)` before render; unbacked keywords
  revert the bullet to its base text and are reported. This is what keeps "rewrite everything" from
  meaning "invent anything".
- Re-score the rendered plain text via `latexToPlainText`, so `score.after` is measured. Report the
  projection and the measurement when they differ.
- `.githooks/pre-commit` and `.github/workflows/build-deploy.yml` build from `resume.tex`; after
  migration CI renders from `resume.json` first. Update the workflow's `paths:` filter.

**Acceptance gate — do not proceed past this:** render `resume.json`, compile, and diff the
extracted PDF text against the committed `apps/web/assets/resume.pdf`. Identical text, one page,
all guards pass. This is the riskiest step in the plan.

- [ ] Schema + restricted markup
- [ ] Renderer + extractor
- [ ] Migration gate passes
- [ ] Full-document tailoring with fact-base validation
- [ ] Measured re-score
- [ ] CI + hook updated

---

## Phase 4 — Web studio

**What:** `apps/studio` — a local Hono server plus a Vite/React/Tailwind SPA for chatting with the
agent, approving actions in modals, and editing the résumé.

**Why:** the CLI is a poor place to review generated copy, approve sends, and see what the agent
did. A visual surface makes the whole system debuggable.

**How:** local-only, binds `127.0.0.1`. It cannot deploy — it needs the filesystem and Docker.
`apps/web` (the deployed Vercel PDF server) is untouched.

Server reuses `buildCli()`, `assembleTools(deps)`, `buildAgent`, `progressPresenter`,
`AGENT_RESOURCE_ID` unchanged — the deps container is already the right seam.

| Route | Purpose |
| --- | --- |
| `POST /api/chat` | SSE stream. Same chunk types `apps/cli/src/commands/chat.ts` handles. |
| `POST /api/confirm/:id` | Resolve a pending confirmation. |
| `GET /api/threads`, `/api/threads/:id` | Past threads from the existing libSQL memory. |
| `POST /api/files` | Upload a JD; returns a path usable as `jdPath`. |
| `GET /api/outputs/*` | Serve tailored PDFs. |
| `GET`/`PUT /api/resume` | Read/write `profile/resume.json`. |
| `GET /api/status` | Existing `collectStatus`. |

**Confirm gate over the wire:** `ConfirmGate` stays `(question) => Promise<boolean>`. The web
implementation emits a `confirm` SSE event with an id, parks the promise in a `Map`, resolves on
the browser's POST. A timeout denies rather than hanging.

Frontend: chat pane with streamed markdown and collapsible reasoning; tool timeline with per-call
timing (already computed in `runTurn`); `ConfirmModal` showing the exact action, recipient, and
attachment; résumé editor beside a PDF preview; status rail; link out to the local Langfuse trace.

- [ ] Server + SSE stream
- [ ] Confirm channel + modal
- [ ] Chat UI + tool timeline
- [ ] Résumé editor + PDF preview
- [ ] Status rail + Langfuse link

---

## Phase 5 — Formatter, linter, comment pass

**What:** Prettier + ESLint configured to match the existing style, enforced in CI, and a
comment pass across all packages.

**Why:** `lint` is currently just `tsc --noEmit`. Style should be enforced by tooling rather than
discipline. See [CONVENTIONS.md](CONVENTIONS.md).

**How:** every disabled rule carries a one-line reason. Judge each comment individually — the
existing headers carry real caveats (the MCP stdout warning in `commands/mcp.ts`, the raw-mode note
in `main.ts`) that must survive. What goes: history notes, restated signatures, duplicated
explanations. Check `/** */` binding while passing through. Formatting lands in its own commit.

- [ ] Prettier + ESLint + CI
- [ ] Comment pass

---

## Phase 6 — Deferred

Revisit once traces exist and the flow is end to end.

- **Context packing.** What goes into each prompt, section priority, per-section budgets — decided
  against real Langfuse traces rather than guessed. Phase 1 only stops the fact base being sent
  malformed.
- **GitHub scraper.** `packages/core/src/scrape/github.ts` calls global `fetch` directly, bypassing
  the `HttpClient` port, and is N+1 sequential: one README call per repo across 45 repos, then up
  to 50 more for star counts. Parallelize with a concurrency cap and route through the port.
- **Prompt versioning and evals** in Langfuse.
