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
