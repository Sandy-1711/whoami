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
| 0 | Handoff docs | done |
| 1 | One LLM path, instrumented | done — one live-trace check outstanding, see below |
| 2 | Flexible tools, unconfusing MCP | in progress — surface reshaped, see below |
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

- [x] Four docs written

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

- [x] `@resume/llm` package
- [x] Prompts on Zod + `serializeFacts`
- [x] Every call site migrated; `packages/core/src/llm` and `ports/llm.ts` deleted
- [x] Langfuse self-hosted and wired
- [x] Fake model (`createFakeLlm`)
- [x] Fake LaTeX/PDF adapters + offline end-to-end tailor test
- [x] Config cleanup

Landed so far: `docs:` handoff docs, `feat(llm)` gateway, `refactor(llm)` injectable
interface, `test(llm)` fake + coverage, `fix(prompts)` truncation, `test(profile)`
serialization, `refactor:` the migration, `feat(llm)` timeout setting,
`feat(infra)` the Langfuse stack, `build(deps)` its packages, `feat(llm)` the
tracer, `test(llm)` its coverage, `feat(cli)` the wiring, `feat(agent)` the Mastra
instance, `test(core)` the fake rendering adapters, `test(tailor)` the offline
end-to-end run.

Two chat behaviours are preserved explicitly in `packages/agent/src/model.ts`
because the gateway's defaults would otherwise revert them: chat prefers Gemini
even when `LLM_PROVIDER` is deepseek, and chat does not inherit `GEMINI_MODEL`.

`OPENROUTER_API_KEY` is still in `.env`. Deleting a live credential to tidy up is
not worth the risk; it is unused and harmless where it is.

Tracing has two entry points, not one, because the pipelines and chat reach a model by
different routes: `startTracing` in `@resume/llm` covers the plain AI SDK calls, and a
`Mastra` instance in `packages/agent/` covers the chat loop. Both export to the same
Langfuse project. `pnpm langfuse:up` starts the stack — see
[../infra/langfuse/README.md](../infra/langfuse/README.md).

**Still unverified:** everything above is covered by unit tests and by `pnpm status`, but no
trace has been watched arriving in a running Langfuse — that needs the stack up and one real
(paid) model call. Do that before trusting the trace list is empty for the right reason.

---

## Phase 2 — Flexible tools, unconfusing MCP

**What:** tools that accept real-world inputs, and an MCP surface an external agent can reason
about without getting lost.

**Why:** "sometimes MCP fails" traces to three things — long tool calls near the client timeout,
a three-process launch chain, and errors that all look the same. "Tools are too rigid" traces to
`jd: z.string()` everywhere.

The sharper statement of the problem, from the session that started this phase: *an agent holding
these tools never knows what to use or when.* Nineteen tools, five of which drafted copy from the
same fact base, two of which had to be called together, and no signal anywhere about what a call
costs or what follows it. Rigid inputs are one layer of that; the shape of the surface is the rest.

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
  **Landed differently:** `.mcp.json` runs `node --import tsx apps/cli/src/main.ts mcp`, which is
  the one process the item was after, without a build. A bundle was written and thrown away: the
  workspace packages export TypeScript source, so they must be bundled, while their dependencies
  are pnpm-isolated under `packages/*/node_modules` where a bundle at `apps/cli/dist` cannot
  resolve them — and bundling those too means bundling `@libsql`'s native bindings. Revisit only
  if tsx's startup transpile becomes the problem.
- Outward-facing tools require an explicit `confirm: true` argument. `runMcp` sets
  `confirm: async () => true` and delegates entirely to the MCP client's prompt — one "always
  allow" and mail goes out unchecked.

### Surface decisions taken mid-phase

These came from working the surface rather than reading it, and they override the tool list the
rest of this document assumed:

- **Nothing is named after one platform any more.** The per-JD note is `outreach_message`'s
  `application_note` kind, with an optional `platform` that names the destination in the prompt
  and the filename and is branched on nowhere — the same note serves Wellfound, Work at a
  Startup, Lever, Greenhouse. `kind` was the only axis that ever varied between five drafting
  tools. The CLI command is `resume note --platform`.
- **The standing Wellfound profile is gone**, command and service. It was a document regenerated
  when the fact base changes, not something to reach for mid-conversation, and the
  `resume-outreach` skill writes it for free.
- **The profile enhancer is gone**, tool and service. The `resume-outreach` skill already does
  that comparison for free, down to the same `linkedin-updates.md`.
- **The tracker must stop being a tool the model remembers to call.** It never worked in practice,
  and over MCP the client's model has no reason to know it exists. Logging has to be *hardcoded
  into the actions*: tailoring a résumé, drafting a note, sending an email each record themselves.
  The store becomes the system's own memory — every action appended, so later sessions can answer
  "what happened with this company?" without asking anyone to have been diligent. `log_application`
  survives only for the status changes a human knows about (interviewing, offer, ghosted).
- **Outreach is a message plus configuration**, not a genre per tool: how polite, how long, who it
  is for. Those belong in the tool's arguments and in the prompt.
- **A tool for the model to ask the user for that configuration.** When the model needs a
  preference it cannot infer — tone, length, which of two angles — it should call a tool that puts
  a concrete question to the user and returns the answer, rather than guessing or asking vaguely
  in prose. In chat that prompts the terminal; over MCP it returns the questions for the client to
  put to the human.
- **GitHub needs read actions, not only the push.** Read a repo's README or description, read the
  user, search where the API allows it. The agent currently pushes to GitHub but cannot look at it.
- **Email is fine as it stands** — draft, then send through the confirm gate.

**Verify:** score a JD by path without pasting; restart the MCP server and send a draft from a
previous session; call `mcp__resume__profile_status` and `mcp__resume__score_jd` from Claude Code
after the `.mcp.json` switch.

- [x] Input resolver applied everywhere (`jd` / `jdPath` / `jdUrl`)
- [x] `opt()` rejects a flag-shaped value
- [x] Grounding reads merged into `read_profile`
- [x] Wellfound tools removed; note generalized to any platform; profile enhancer deleted
- [x] Automatic activity log; tracker stops depending on the model
- [x] Outreach configuration (tone, length) + `ask_user`
- [x] GitHub read/search actions
- [x] Uniform tool descriptions (cost, when, when-not, what follows) + `nextSteps`
- [x] `send_application_email` falls back to the saved draft file
- [x] `update_facts` batch; `check_resume` scope enum + CLI naming
- [x] `tailor_plan` / `tailor_render` split
- [x] One-process MCP launch (no `dist` — see above)
- [x] Explicit confirm argument

**Open question — should drafting be a tool at all?** Raised mid-phase and not yet decided. What
the toolkit uniquely provides is not prose: it is the grounding (fact base + evidence), the
deterministic JD classification (`missing` is computed, and it is what stops invention), the filing,
and the recording. The prose is the one part any capable model can do — and in chat the drafting
model *is* the agent, while over MCP the client's model is usually stronger than the cheap one the
tool pays for. What a tool does guarantee is that the house rules and the filing happen even for a
client that ignores instructions.

The shape that keeps the guarantee without the second model: `draft_context({ kind, jd?, company? })`
returning facts, evidence, classification, house-style rules, word budget and the destination path;
`save_draft({ kind, company, platform?, text })` validating the text against the fact base, writing
it to the canonical path and recording it. Both free. `outreach_message` survives as the "write it
for me" fallback rather than the main path. **Decide before Phase 3**, since Phase 3's tailoring
faces the same question for résumé bullets.

**Open question — CLI equivalents vs MCP.** Every capability currently exists twice: a `pnpm`
command and an MCP tool, with skills as a third, unpaid path. That split was deliberate — a Claude
Code session writing the copy costs nothing where the API costs credits — but it works against the
project's own vision of one agent driving one toolkit, and it is why the skills tell agents *not*
to call half the tools. Deciding what the CLI is for once MCP exists is deferred, not settled.

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
