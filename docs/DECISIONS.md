# Decisions

Choices made for the hardening work, with the reasoning. Append as new ones land; do not rewrite
old entries — supersede them with a new one that says what changed.

## 2026-08-25 — Gemini primary, DeepSeek secondary, no OpenRouter

Credits live in Gemini, with a little in DeepSeek. `.env` currently sets `LLM_PROVIDER=deepseek`,
which routes every pipeline through the provider that has **no server-side schema enforcement** —
`providers/deepseek.ts` pastes the schema into the prompt and hopes, while Gemini enforces it via
`responseSchema`. The less reliable path is the current default, which is not intended.

`OPENROUTER_API_KEY` is set in `.env` with no OpenRouter provider anywhere in the code. Removed
rather than implemented.

## 2026-08-25 — One LLM gateway on the AI SDK

Two stacks exist today: hand-rolled `fetch` providers in `packages/core/src/llm/` for the
pipelines, and the Vercel AI SDK via Mastra for chat. Same keys, two abstractions, two sets of
bugs, two places to add a provider — and no single place to attach tracing.

Collapsing onto the AI SDK (already a dependency through Mastra) gives one instrumented call site,
`generateObject` with Zod for free runtime validation of model output, and one retry/timeout
policy. The hand-rolled `LlmProvider` port and `JsonSchema` type retire.

## 2026-08-25 — Langfuse, self-hosted

Traces are the point of the exercise: there is currently no way to see what context reaches a
model. Self-hosted keeps prompts and JD text on the machine. Docker is already required for LaTeX
builds, so the dependency is not new.

The trade-off accepted: the Langfuse v3 stack is Postgres + ClickHouse + Redis + MinIO, which is
heavy to keep running on a dev machine. Switching to Langfuse Cloud is a three-line `.env` change
if it proves too much — the tracing code does not care which it points at.

Tracing must degrade to a no-op when Langfuse is down or `LANGFUSE_ENABLED` is unset. An
observability outage must never fail a résumé run.

## 2026-08-25 — Tracing has two entry points

The Langfuse decision above assumed one place to attach tracing. There are two, because there
are two ways a model gets called: the pipelines go straight through `@resume/llm` to the AI SDK,
while chat goes through a Mastra `Agent`, and Mastra attaches observability to the *container*
rather than to the agent.

So `startTracing` in `@resume/llm` registers a global OpenTelemetry provider for the pipelines,
and `packages/agent/` gained a `Mastra` instance carrying a `LangfuseExporter` for chat. Both
point at the same Langfuse project, so the split is invisible in the UI.

Spans from the pipelines carry OpenTelemetry `gen_ai.*` attributes. That is not decoration:
Langfuse's exporter filters for exactly those names and silently drops spans without them.

Both paths are off, and unloaded, unless `LANGFUSE_ENABLED` is set with both keys.

The upstream self-host compose file is now Langfuse v4 rather than the v3 assumed above. Same
Postgres + ClickHouse + Redis + MinIO stack, so nothing about the decision changes.

## 2026-08-27 — A trace root says so, and the empty trace list was not the reason

[#8](https://github.com/Sandy-1711/whoami/issues/8) read the empty Traces list as a missing
`langfuse.internal.as_root`. Checked against the running instance, that does not hold. Langfuse v4's
list predicate is `(parent_span_id = '' OR is_app_root = true)`, and both existing traces already
satisfied the first half — running the UI's own query against the stored data returns both, correctly
named, with their observation counts. A synthetic unmarked root sent afterwards was listed too.

What the ClickHouse `query_log` shows instead: the "does this project have any data" probe returned
**zero rows** at 07:57:18, thirty-five seconds before the first span landed. The list was opened
against an empty project and never queried again — every later view was a trace reached by direct URL
from the studio's Langfuse link. The list was empty because there was nothing in it yet.

The marker is worth writing anyway, and `markTraceRoots` writes it: `is_app_root` is what the list
filters on, and today it is false on every span the toolkit has ever sent, so a root is recognised by
accident of structure rather than by intent. Structure is the weaker of the two — a span that later
gains a parent stops being a root silently.

It goes on the pipelines only. `@mastra/langfuse`'s exporter constructs its `LangfuseSpanProcessor` in
a private field and calls `onEnd` on it directly, bypassing any tracer provider, and its span
converter emits a fixed set of attribute names with no passthrough. There is no seam for a processor,
an exporter wrapper, or a metadata key. The alternatives were vendoring its 75-line attribute mapping
or patching a dependency's prototype; neither is worth it for a marker that changes nothing the list
does today.

## 2026-08-25 — Résumé becomes structured data

`resume.tex` declares three `TAILOR` anchors and only two are ever written; the `skills` anchor is
dead. Experience and project bullets are byte-identical across all eight companies in `tailored/`.
"Tailoring" means rewriting one sentence and a three-phrase tagline.

Two ways to fix it: more anchors in the `.tex`, or make `profile/resume.json` the source of truth
with `resume.tex` as a rendered artifact. The second was chosen because it also removes the class
of bugs where a model emits broken LaTeX — with a restricted markup (`**bold**` and `[label](url)`)
the model never writes LaTeX at all, and the renderer escapes everything first.

It also makes guards structural and gives the web studio something to edit.

The migration is the riskiest step in the plan, so it carries a hard acceptance gate: PDF text
rendered from `resume.json` must be identical to the committed `apps/web/assets/resume.pdf`.

## 2026-08-26 — Three markers, and they are consumed before escaping

The restricted-markup decision above said two markers. It shipped with three: `` `code` `` joins
`**bold**` and `[label](url)`, because the résumé sets one token in typewriter and the migration's
acceptance gate was "the document does not change". A marker the writer already knows from markdown
is a smaller cost than a silent typographic regression.

Order matters more than the count. Markers are tokenized out of the prose *first*, and only what
falls between them is escaped. The alternative — escape, then convert — breaks on the curly quote,
which is spelled with two backticks in TeX and would then be read as an empty code span.

## 2026-08-26 — The fact-base check lives in profile/, not tailor/

`unbackedClaims` compares a piece of generated copy against the fact base and against the line it is
replacing. It is what makes "the model may rewrite every bullet" safe: an unbacked claim is dropped
and the original text kept.

It sits in `packages/core/src/profile/` rather than under `tailor/` because outreach notes, cold
emails and application emails have the same exposure and nothing checks them today either. Moving it
later would be a refactor nobody schedules; putting it there now costs nothing.

It is not yet wired into outreach or email. The deferred `save_draft`/`draft_context` shapes at the
end of Phase 2 are the way to do that, and they should wait for evidence: reverting a résumé bullet
is cheap to notice and easy to re-ask for, while refusing to save an otherwise good cold email is
not. A few real tailoring runs will say how often the check is wrong before it gets a veto over
copy that leaves the machine.

The check knows two kinds of claim — technologies from the shared lexicon, and figures. A technology
this repo has never named anywhere passes unseen. That is the same vocabulary JD scoring reasons in,
so widening the lexicon widens both at once.

## 2026-08-26 — CI still compiles the committed resume.tex

Phase 3 planned for CI to render `resume.json` before compiling. It does not: it compiles the
committed `resume.tex`, and the source guard fails the build when that file is not what the document
renders to.

Same mistake caught, one step earlier and with a better message — and the PDF cache stays keyed on
`hashFiles('resume.tex')`, which only works because the file is committed. Both local build paths
(`pnpm build:pdf` and the agent's `build_resume`) do render first, so the committed artifact is
produced by the same code CI checks it against.

## 2026-08-25 — Web studio: Hono + Vite React, local-only

A separate `apps/studio`, not an extension of `apps/web` — the studio needs the filesystem and
Docker, so it cannot deploy. `apps/web` stays exactly what it is: the Vercel functions that serve
the published PDF.

Hono plus a Vite SPA over Next.js or Mastra's own playground, because the permission-modal flow is
custom: `ConfirmGate` has to travel over the wire (SSE event out, POST back), and Mastra's stock
playground has no such concept. A thin server keeps that mechanism simple and leaves the UI fully
under our control.

## 2026-08-25 — Context packing deferred

Fixing *what* goes into each prompt is deferred to Phase 6, deliberately. The end-to-end flow
should be solid and traceable first, so the packing decisions can be made against real Langfuse
traces rather than guessed.

Phase 1 does the minimum: stop sending the fact base truncated mid-string. Today
`JSON.stringify(facts).slice(0, 12000)` against a 15,826-character fact base severs `projects`
mid-value and drops `headline_metrics` entirely — while the prompts instruct the model to draw
achievements "ONLY from headline_metrics". That is a correctness bug, not an optimization.

## 2026-08-27 — Vite runs inside the studio server, not beside it

The studio could have been a Vite dev server proxying `/api` to Hono, or a built SPA that Hono
serves from `dist/`. It is neither: the server creates Vite in **middleware mode** and dispatches
`/api` to Hono and everything else to Vite's middlewares.

One process, one port, no build step, and HMR — the same call Phase 2 made when it dropped the MCP
bundle in favour of running the source under `tsx`, and for the same reason: a launch chain in front
of every session is a cost paid constantly to save a dependency once.

The trade-off accepted: Vite and its plugins are runtime dependencies of the studio. That is honest
for a tool that binds `127.0.0.1`, cannot deploy, and needs Docker and the filesystem anyway.

## 2026-08-27 — The studio builds its agent per turn

`buildAgent` is called once per turn rather than once per server, reusing the memory store and the
tracing pipeline that `createStudio` opened.

The presenter and the two gates belong to *one stream*: a confirm modal has to appear in the tab
that asked for it, and progress lines have to land under the turn that produced them. Binding them
at server scope would mean a mutable "currently active stream" the gates read — correct only while
exactly one turn is in flight, and silently wrong the moment a second tab opens.

Rebuilding costs an `Agent` and a `Mastra` object. Memory and observability are passed in because
each is expensive or duplicative to re-create — one libSQL handle, one exporter, one batch timer.
That is why `buildObservability` became public: `buildMemory` already was, for exactly this reason.

## 2026-08-27 — Unanswered means refused

The studio's gates can end four ways: answered, timed out, the browser hung up, or the event never
reached the wire. Only the first is an answer. The other three resolve to refusal.

The alternative — leave it pending — is worse than it sounds. It holds a tool call open indefinitely
with nothing on screen capable of answering it, and the run keeps whatever it had already paid for.
A gate that cannot be answered would hang the call, which is the same reasoning that made `runMcp`
delegate to the client's prompt rather than wire a gate with no terminal behind it.

`ask_user` is the exception that proves the shape: it throws instead of returning, because a blank
preference is not a refusal — it is a guess the model would treat as chosen.

## 2026-08-27 — The studio edits fields, and PUTs the whole document

The résumé editor could have been a JSON textarea. It edits typed fields over a working copy and
PUTs the entire document, so `parseResume` on the server stays the only definition of a valid
résumé and the browser never holds a second one.

Ids are rendered and not editable. An id is what a tailoring edit addresses a bullet by; renaming
one silently detaches every plan that already referred to it.
