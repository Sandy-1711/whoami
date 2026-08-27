# Phases

The hardening plan as it was built. Phases 0 to 4 are done; this is the plan as written, annotated
where the build went another way and why.

This file is history. **[ROADMAP.md](ROADMAP.md) is what is left** — read that to resume work, and
read this to understand why something is the way it is. Phases 5 and 6 are not started and live
there, not here.

Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) (target design), [DECISIONS.md](DECISIONS.md)
(choices and why), [CONVENTIONS.md](CONVENTIONS.md) (how to write the code), [CLI.md](CLI.md) and
[STUDIO.md](STUDIO.md) (the two operator surfaces).

---

## Why this work exists

This was the state at the start, and Phases 1 to 3 closed all of it. Kept because it is the argument
for the whole plan, not a to-do list — read it for the reasoning, not the status.

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
- Tailoring rewrites two lines. Experience and project bullets are identical across every
  company in `tailored/`.
- The reported ATS "after" score is a projection computed before the model runs, never
  measured.
- The fact base is truncated mid-string by a blind `.slice()`, and `headline_metrics` never reaches
  the model at all.

---

## Phase 0 — Handoff docs

**What:** `docs/ROADMAP.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `CONVENTIONS.md`.

**Why:** the work spans several sessions. A new chat needs to resume without re-deriving the whole
codebase.

**How:** `ROADMAP.md` carries status and per-phase what/why/how; the others carry the stable
background. Keep them short enough that reading all four is cheap.

- [x] Four docs written

The per-phase half of that later outgrew the file it was written in and became this one, so the
roadmap could be about what is left rather than about what is finished.

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

**Verified 2026-08-27.** Traces arrive: one real studio turn produced 45 events across 2 traces in
a running self-hosted Langfuse, carrying prompts, replies, token counts and cost.

The trace list looked empty, and [#8](https://github.com/Sandy-1711/whoami/issues/8) read that as a
missing `langfuse.internal.as_root`. Checked against the running instance, it was not: Langfuse lists
a parentless span with no marker at all, and does list both of these. The list was opened against a
project that had no spans in it yet, and every view after that reached a trace by direct URL. The
marker is written anyway — [DECISIONS.md](DECISIONS.md) has what it buys and why only the pipelines
carry it. The split entry points are [#15](https://github.com/Sandy-1711/whoami/issues/15).

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
- Anything that spends credits, leaves the machine, or rewrites the grounding stops at
  `deps.confirm`, and the prompt shows the call: tool id, the values it resolved to, and the exact
  text that will go out. **Landed differently:** an explicit `confirm: true` argument was built
  first and then removed. It reads as a safety check and is not one — it is the model asserting
  that the user approved something, with no user involved. What makes an approval real is that the
  recipient, the subject and the body are on the screen when the question is asked.
  `runMcp` still delegates to the MCP client's own prompt: there is no terminal to reach on that
  path, and a gate that cannot be answered would hang the call. One "always allow" there and the
  gate is gone — what still holds is the draft-first rule, since `send_application_email` can only
  transmit bytes an earlier drafting call wrote under `tailored/`.

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
- **The live LinkedIn scrape is deprecated**, not deleted. It automates a site against its terms
  with the user's own session cookie, and the data barely moves; a PDF export covers it.
  `profile/linkedin.json` is still read, the scraper still backs the PDF path, and `sync --linkedin`
  now explains itself instead of running.

**Verify:** score a JD by path without pasting; restart the MCP server and send a draft from a
previous session; call `mcp__resume__profile_status` and `mcp__resume__score_jd` from Claude Code
after the `.mcp.json` switch; `resume send --company X --dry-run` renders a saved draft with no
model call.

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
- [x] Confirm gate shows the resolved call (tool, values, body) before it runs
- [x] Live LinkedIn scrape deprecated
- [x] CLI cut to the operator surface; `resume send` replaces `resume email`

**Resolved — the CLI stops running paid pipelines.** Every capability existed twice, a `pnpm`
command and a tool, and the duplication was never a decision: the CLI came first, the tools
wrapped it, and the skills were bolted on as the unpaid escape hatch. Whichever copy was edited,
the other drifted, and the skills spent their word budget telling agents which half to avoid.

`tailor`, `note`, `email` and the `wellfound` alias are gone. What stays is the surface worth
having without an agent — `build` and `check` (CI and the pre-commit hook run them), the free
deterministic reads (`score`, `digest`, `status`), `sync`, and the two entry points `chat` and
`mcp`. Nothing left on the command line calls a model, which makes the cost rule one sentence
instead of a table.

`resume send` is what replaced `resume email`, and it is the half that was missing rather than a
thinner version of what was there. Two skills documented "write the draft yourself, then
`pnpm email --company X` sends it verbatim"; that path did not exist, because the command always
drafted with a model first. It exists now: read the saved draft, show it, confirm the recipient,
send. `EmailService.loadFileDraft` was already carrying it for the agent's send tool.

**Deferred to Phase 3 — should drafting be split from the model call?** Not the email draft, which
is settled and fine: draft, show, gate, send. The open version is narrower and belongs with
Phase 3's bullet rewriting. What the toolkit uniquely provides is the grounding (fact base +
evidence), the deterministic classification (`missing` is computed, and it is what stops
invention), the filing, and the recording — while the prose is the part any capable model can do,
and over MCP the client's model is usually stronger than the cheap one the tool pays for.

The shape that keeps the guarantee without the second model: `draft_context({ kind, jd?, company? })`
returning facts, evidence, classification, house-style rules, word budget and the destination path;
`save_draft({ kind, company, platform?, text })` validating the text against the fact base, writing
it to the canonical path and recording it. Both free. `outreach_message` survives as the "write it
for me" fallback.

One finding makes this worth doing rather than merely cheaper: **nothing validates generated copy
against the fact base today, in any path.** `factIndex` in `packages/core/src/tailor/core.ts` is
called from exactly one place — `classify()`, on JD keywords. `outreach_message` reports `gaps` and
tells the model the note "claims none of" them, which is an assertion about the prompt, not a check
on the output. Phase 3 already plans that validator for résumé bullets; building it as `save_draft`
means outreach gets it too.

---

## Phase 3 — Résumé as structured data

**What:** `profile/resume.json` becomes the source of truth; `resume.tex` becomes a rendered
artifact. Tailoring can then rewrite every section.

**Done.** What follows is the plan as written, annotated where the build went another way.

**Why:** tailoring two lines is not tailoring, and letting a model write LaTeX directly is how the
output breaks. Structured data removes both problems at once.

**How:**

- `packages/core/src/resume/schema.ts` — Zod schema (identity, subtitle, summary, experience,
  projects, skills, education; stable `id` on each entry).
- **Restricted markup** in all prose: `**bold**` and `[label](url)`, nothing else. The renderer
  escapes via the existing `latexEscape` first, then converts the two markers. The model never
  emits LaTeX. `boldify`'s first-occurrence heuristic retires.
  **Landed as three markers, not two:** `` `code` `` is the third, because the résumé sets one
  token (`allow-same-origin`) in typewriter and the migration had to not degrade the document. The
  markers are consumed before escaping rather than after, so the two-backtick spelling of a curly
  quote cannot be read as a code span.
- `packages/core/src/resume/render.ts` — JSON → `.tex`, composing the preamble/macros partial
  (verbatim from current `resume.tex` lines 1–68) with a generated body.
- `packages/core/src/resume/extract.ts` — one-time `resume.tex` → `resume.json` migration.
- `TailorService.plan()` produces a validated `ResumeEdit` addressing bullets by `id`; `render()`
  applies it. The service was split in Phase 2 (plan = the model call, saved to
  `tailored/<company>/tailor-plan.json`; render = compile + guards + the tighten loop), so the
  edit lands in `plan()` and nothing about the split needs revisiting.
- Every rewritten bullet is checked against `factIndex(facts)` before render; unbacked keywords
  revert the bullet to its base text and are reported. This is what keeps "rewrite everything" from
  meaning "invent anything". **`factIndex` is currently dead weight for this purpose** — it exists
  in `packages/core/src/tailor/core.ts` but is only ever called by `classify()` on JD keywords, so
  no path validates generated text against the fact base today. This bullet builds the first one.
- **Decide here:** whether the same validator becomes `save_draft`, so outreach and email copy are
  checked too, and whether `draft_context` replaces paying a second model for prose. See the
  deferred question at the end of Phase 2 — the argument and the proposed shapes are written up
  there. **Decided:** the validator was built as `unbackedClaims` in `packages/core/src/profile/`,
  not under `tailor/`, so outreach and email can adopt it without moving anything. Wiring it into
  `save_draft`/`draft_context` is deliberately not done yet — that is a tool-surface change, and it
  should wait until a few real tailoring runs say how often the check reverts a line that was
  actually true. Reverting a bullet is cheap to notice; refusing to save a good cold email is not.
- Re-score the rendered plain text via `latexToPlainText`, so `score.after` is measured. Report the
  projection and the measurement when they differ. **Landed differently:** the score is measured on
  the document that rendered (`resumePlainText`) rather than by stripping the LaTeX back off. Same
  words, one fewer lossy step, and it no longer depends on the `.tex` being current.
- `.githooks/pre-commit` and `.github/workflows/build-deploy.yml` build from `resume.tex`; after
  migration CI renders from `resume.json` first. Update the workflow's `paths:` filter.
  **Landed differently:** CI still compiles the committed `resume.tex` — the source guard already
  fails when that file is not what `resume.json` renders to, which catches the same mistake one
  step earlier and keeps the PDF cache keyed on a committed file. Both local build paths render
  first.

**Acceptance gate — do not proceed past this:** render `resume.json`, compile, and diff the
extracted PDF text against the committed `apps/web/assets/resume.pdf`. Identical text, one page,
all guards pass. This is the riskiest step in the plan.

**Passed.** The baseline was rebuilt from the hand-written `resume.tex` first rather than trusting
the PDF on disk, then rebuilt from `resume.json`: 3597 characters of extracted text, byte-identical,
one page, all three guards green. Only whitespace, the dropped TAILOR anchors and a trailing newline
differ in the `.tex`.

- [x] Schema + restricted markup
- [x] Renderer + extractor
- [x] Migration gate passes
- [x] Full-document tailoring with fact-base validation
- [x] Measured re-score
- [x] CI + hook updated

Two bugs surfaced on the way and were fixed under their own commits: `latexEscape` escaped the
braces of its own `\textbackslash{}` replacement, and `termInText` refused any term followed by a
dot — so a bullet ending "…on FastAPI." never counted as covering FastAPI, and every score that
mattered read low for it.

**Not done, and deliberately:** skills are not tailored. The dead `TAILOR:skills` anchor is gone,
but the model is not asked to reorder or select skill groups per JD. Surfacing an addable keyword
usually means adding it to a skills line, so this is the obvious next lever on the score — it just
needs the reordering to be a constrained edit (pick from what is there) rather than free text.

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
| `GET`/`PUT /api/resume` | Read/write `profile/resume.json` — `parseResume` validates the PUT, `writeResumeTex` re-renders after it. |
| `GET /api/status` | Existing `collectStatus`. |

**Confirm gate over the wire:** `ConfirmGate` is `(request: ConfirmRequest) => Promise<boolean>`
since Phase 2 — `{ tool, action, params, preview }`, the resolved values rather than a sentence
about them. That is what the modal renders, and `formatConfirm` in `packages/agent/src/confirm.ts`
already lays the same fields out for a terminal. The web implementation emits a `confirm` SSE event
carrying the request and an id, parks the promise in a `Map`, and resolves on the browser's POST. A
timeout denies rather than hanging; `denyGate` is the default so a missing wiring cannot
auto-approve.

Frontend: chat pane with streamed markdown and collapsible reasoning; tool timeline with per-call
timing (already computed in `runTurn`); `ConfirmModal` showing the exact action, recipient, and
attachment; résumé editor beside a PDF preview; status rail; link out to the local Langfuse trace.

**Markdown did not land with the phase** — the pane printed raw text, so a structured answer arrived
as asterisks and hashes. Closed since, under
[#10](https://github.com/Sandy-1711/whoami/issues/10).

- [x] Server + SSE stream
- [x] Confirm channel + modal
- [x] Chat UI + tool timeline
- [x] Résumé editor + PDF preview
- [x] Status rail + Langfuse link

**Done.** `pnpm studio` → `127.0.0.1:4321`. Full write-up in [STUDIO.md](STUDIO.md); the calls it
made are in [DECISIONS.md](DECISIONS.md). Where it went another way, or further:

- **One process, one port, no build step.** The plan implied a Vite dev server beside the Hono one.
  Vite runs *inside* the server in middleware mode instead, dispatching `/api` to Hono and the rest
  to Vite's middlewares — the same call Phase 2 made when it dropped the MCP bundle for `tsx`.
- **Deps are built per turn**, not per server. The presenter and the gates belong to one stream: a
  confirm modal has to appear in the tab that asked for it. Memory and the tracing pipeline are the
  studio's, opened once and passed in, which is why `buildObservability` became public alongside
  `buildMemory`.
- **`@resume/cli` gained a package entry.** The plan said the server reuses `buildCli()`; it could
  not, because the package declared a bin and no exports. `apps/cli/src/index.ts` exports the
  container and the two environment probes, and the Playwright probe that three commands had each
  copied is now one function.
- **Closing the stream cancels the turn.** Not in the plan, and the Stop button is a lie without it:
  the run would keep stepping and keep spending into a socket with nobody reading.
- **`POST /api/resume/build`** was added beyond the route table. Saving the document re-renders
  `resume.tex` instantly, but the PDF pane shows a stale render until something compiles, and
  dropping to a terminal for that defeats the pane.
- **`POST /api/ask/:id`** was added too — `ask_user` is a gate like `confirm` and had nowhere to be
  answered. Unanswered *throws* rather than returning blanks, because a blank preference is not a
  refusal, it is a guess the model would treat as chosen.
- **The editor edits fields, not JSON**, and PUTs the whole document so `parseResume` on the server
  stays the only definition of a valid résumé. Ids are shown and not editable.

Two bugs found by actually opening the page rather than curling it, both fixed under their own
commits: the `/api` prefix test swallowed the SPA's own `/api.ts` — every route looked healthy from
the shell while the browser got a blank page — and the panes overflowed their grid tracks because a
grid item will not shrink below its content without `min-w-0`.

**Then it was used, and that found ten more.** Two were fixed on the branch — the Mastra container
had no store and warned on every boot that it was falling back to an in-memory one, and the user's
own message was styled as highlighted. The rest became issues #8–#19. None of them says the shape is
wrong; they say a shipped surface only tells you the truth once somebody uses it. Using it again said
the same thing twice more: a thread could not be deleted and a pane could not be resized, neither of
which anyone noticed until the panes had something worth rearranging in them.

One of the twelve turned out not to be a finding at all: #8's empty trace list was a page opened
against a project with nothing in it yet. That is the same lesson pointing the other way — a surface
being used tells you the truth, and a surface being used *once* tells you a story about it.

---

## After Phase 4 — the studio findings

Seven of the twelve are closed. The five that remain are in
[ROADMAP.md](ROADMAP.md).

| Issue | What landed |
| --- | --- |
| [#8](https://github.com/Sandy-1711/whoami/issues/8) Langfuse traces are unlistable | **The diagnosis does not hold.** `markTraceRoots` in `packages/llm/src/tracing.ts` stamps the marker on the pipelines; the chat path cannot carry it and does not need to. The list was never broken. |
| [#9](https://github.com/Sandy-1711/whoami/issues/9) A built résumé vanishes | `server/artifacts.ts` picks the openable files out of a tool result, `relay.ts` sends them, `components/ArtifactCard.tsx` draws preview, download, the measured ATS score and the guard verdict. The pdf pane's picker re-lists when a turn ends. |
| [#10](https://github.com/Sandy-1711/whoami/issues/10) Markdown does not render in the studio chat | `web/markdown.ts` parses to data, `components/Markdown.tsx` draws it, in two tones — the answer and the thinking block both render. |
| [#11](https://github.com/Sandy-1711/whoami/issues/11) Reopened threads lose their tool calls | `server/transcript.ts` reads a stored message back to its text, thinking, calls and cards; the timeline draws a restored call grey with no duration, because the store keeps every part of a turn but its clock. |
| [#12](https://github.com/Sandy-1711/whoami/issues/12) Thread titles say nothing | `packages/agent/src/titles.ts` names a thread after the company a call resolved, else after the line that opened it. Mastra's `generateTitle` is off — two writers would race over the field on the first turn, which is the turn a company is most likely to be named. `AGENT_TITLE_MODEL` went with it. |
| [#13](https://github.com/Sandy-1711/whoami/issues/13) Attach JD is a file picker only | The paste box posts to the `text` field `POST /api/files` had all along, so both routes end at a path under `.agent/jd/`. |
| [#14](https://github.com/Sandy-1711/whoami/issues/14) The résumé editor is open by default | It opens from the pdf pane. `web/useResume.ts` holds the document above the pane, so closing it with an unsaved edit keeps the edit and the button says so. |

Two more came out of using it, neither filed:

- **A thread could not be deleted**, so every abandoned turn stayed in the rail forever.
  `DELETE /api/threads/:id`, and a `×` that arms before it destroys anything.
- **The panes could not be resized.** Every gutter is a splitter now
  (`web/components/Splitter.tsx`); opening the editor widens its whole column rather than halving
  the pdf pane, which at half width could not fit its own controls.

And one refactor nobody asked for, which the work demanded. **`server/relay.ts`** — turning agent
stream chunks into browser events was buried in `runTurn`, reachable only by spending a real turn.
That is how the artifact events shipped unexercised while every test around them passed. It is its own
module now, driven by hand in `relay.test.ts`, and the field names it reads by key (`payload.result`
above all) are pinned there.
