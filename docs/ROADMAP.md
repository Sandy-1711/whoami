# Roadmap

**Read this first.** It is the handoff file, and it is about **what is left**. Everything already
built moved to [PHASES.md](PHASES.md); nothing below is finished work. Update this file in the same
session that changes code — an item is not done until it leaves here.

Companion docs: [PHASES.md](PHASES.md) (what was built, and why it went the way it did),
[ARCHITECTURE.md](ARCHITECTURE.md) (target design), [DECISIONS.md](DECISIONS.md) (choices and why),
[CONVENTIONS.md](CONVENTIONS.md) (how to write the code), [CLI.md](CLI.md) and
[STUDIO.md](STUDIO.md) (the two operator surfaces).

**How to read this file.** *Where the code is* and *What is proven* orient you. *What is left* is the
work, in the order to do it. *Working on this repo* is the handful of traps that cost real time; read
it before touching the studio.

## Status

| Phase | What | State |
| --- | --- | --- |
| 0–4 | Docs, one LLM path, the tool surface, the résumé as data, the web studio | done — [PHASES.md](PHASES.md) |
| 5 | Formatter, linter, comment pass | not started — below |
| 6 | Deferred work | not started — below |

The phases were the plan and they are spent. Day-to-day work is the
**[issue tracker](https://github.com/Sandy-1711/whoami/issues)** now, and Phase 5 is not next — the
open issues are, in the order given under *What is left*.

---

## Where the code is

**Everything is on `main`,** including the twelve findings the first real use of the studio produced.
Nothing is waiting on a branch.

**Three stale duplicates of `main` exist — `hardening`, `studio`, `fix/high-priority-findings`.** Each
was rebase-merged, so `main` carries the same work under different SHAs and the branch is left looking
unmerged to `git`. Do not branch from any of them. Cut new work from `main`, one concern per commit.

```sh
git log --oneline -40         # everything recent
```

**What exists now.** Three front ends over one tool set, and a résumé that is data:

- **18 tools**, assembled in one place — `assembleTools` in `packages/agent/src/agent.ts`.
  `pnpm chat`, `pnpm mcp` and `pnpm studio` all wire exactly that set, so they cannot drift apart.
  `recordTools` wraps every one, so each call appends to `.agent/activity.jsonl` and updates the
  tracker without any tool opting in.
- **No command calls a model.** `chat`, `mcp` and `studio` reach the agent; `send`, `sync`, `score`,
  `digest`, `status`, `build`, `check` are the operator surface and are free by construction.
- **The confirm gate** takes a `ConfirmRequest { tool, action, params, preview }` — the resolved
  values, never a sentence about them. The terminal prints them; the studio renders them in a modal.
  Nothing is approved by an argument.
- **The résumé is `profile/resume.json`.** `resume.tex` is rendered from it by both build paths and
  guarded for staleness; nothing hand-edits the LaTeX.

---

## What is proven, and what is not

### Watched working

Everything below has been observed end to end, not merely unit-tested. All 2026-08-27: the first
three from a real studio turn and the Langfuse trace it produced, the rest from driving the running
instance directly — a span pushed into Langfuse, a browser pointed at the studio — which costs
nothing and is how anything here should be checked before it is claimed.

- **A full studio turn against a real model.** `score_jd` → `ask_user` → `tailor_plan` →
  `tailor_render` → `updateWorkingMemory`. The ask modal parked the run for 36 seconds waiting on a
  human and resumed with the answer, which exercises the browser-backed gate for real.
- **Document-wide tailoring against a real model** — the first since the Phase 3 rewrite.
  `tailor_render` compiled for 63 seconds and produced a PDF.
- **Traces arrive in a running Langfuse.** 45 events across 2 traces, with prompts, replies, tokens
  and cost. This closes the Phase 1 item that had been outstanding since it was written.
- **Traces list.** The Langfuse Traces list shows them. Confirmed by sending a synthetic trace into
  the running instance and finding it in the list — see [DECISIONS.md](DECISIONS.md), because the
  issue that said otherwise was wrong.
- **A root span carries Langfuse's marker.** A real span pushed through `startTracing` into the live
  instance came back with `is_app_root = true` in ClickHouse, its child untouched. No model call.
- **Markdown and the artifact card, as rendered pages.** Driven with Playwright against the running
  studio: headings, lists, quotes, links and fences draw; a long line scrolls inside its `pre` with
  the page's own scroll width unchanged; previewing a card switches the pdf pane to that file; the
  download link returns 200, `application/pdf`, 116,935 bytes.
- **The four studio issues, driven in a browser.** Playwright again, against a second instance on
  `--port 4399` because the one on 4321 was running server code from before the changes — which is
  the trap below, met in the wild. Reopening the Serval thread rebuilt `score_jd → tailor_plan →
  tailor_render` with its thinking and its artifact card, every call grey and undated; pasting a JD
  wrote `.agent/jd/…` and attached the path; `detach` cleared it; the page loaded with no résumé
  pane, and an edit typed into it survived closing and reopening (`edit · unsaved` on the button);
  dragging moved the columns `224px → 379px` and the rail rows `220px → 335px`. A thread seeded into
  libSQL for the purpose armed, deleted, and was gone from the store — no real thread was touched.

### Not watched working

- `resume send` has only ever run with `--dry-run`. It has never put a real message through Gmail.
- Over MCP the confirm gate auto-approves, because there is no terminal to prompt. MCP elicitation
  was never explored; the draft-first rule is what holds under a client set to "always allow".
- The studio's **build** button. `tailor_render` compiles through a different path, so the toolchain
  is proven but `POST /api/resume/build` specifically is not.
- **The artifact card in a real turn.** The relay that emits it is covered by tests driven with the
  chunk shapes `@mastra/core` documents, and the card itself was driven with a hand-built turn — but
  no paid turn has produced one yet.
- **The PDF pane rendering a PDF.** The route is proven; headless Chromium has no PDF viewer, so the
  iframe was blank in every screenshot. Worth one glance with the studio open.

---

## What is left

The first real use of the studio produced twelve findings, filed as issues. Seven are done and
written up in [PHASES.md](PHASES.md); five remain.

### Issues

| Priority | Issue |
| --- | --- |
| medium | [#15](https://github.com/Sandy-1711/whoami/issues/15) The tailor generation is an orphan trace — one of four, see *Tracing* below |
| medium | [#16](https://github.com/Sandy-1711/whoami/issues/16) Nothing in the product's own voice should name the model |
| low | [#17](https://github.com/Sandy-1711/whoami/issues/17) Replace the tailor pipeline with `draft_context` + `save_draft` |
| low | [#18](https://github.com/Sandy-1711/whoami/issues/18) ARCHITECTURE.md claims chat and pipeline traces nest |
| low | [#19](https://github.com/Sandy-1711/whoami/issues/19) The evidence-digest test asserts a budget against live scraped data |

**One bug has no issue.** `DETAIL.tailor_plan` in `packages/agent/src/recording.ts` reads the score
off a `tailored` key, but `tailor_plan` returns `{ current, projected }` — so every activity line it
writes reads `score 60→undefined`. One word.

**`pnpm test` is currently red** — [#19](https://github.com/Sandy-1711/whoami/issues/19). A `sync`
grew `profile/github.json` past a hard-coded size budget the test asserts. No code change caused it,
and any future `sync` can cause it again. It is the only failure; anything else is yours.

### Tracing — four things wrong with it, in the order to fix them

Traces arrive and the list works. Reading one is still poor, for four separate reasons, only one of
which has an issue. Measured against the two real turns of 2026-08-27; **the Langfuse instance has
since been emptied deliberately, so the figures below are the record rather than something to
re-derive.** The project, its API key and the `.env` credentials survived that reset.

**1. Tailoring is a different trace from the turn that caused it.** The tailoring call cost $0.0694
against $0.0235 for the entire chat turn — three times the price of everything else — and it sat
alone in a one-span trace with no parent. Open the turn and `tailor_plan` shows 72 seconds and
nothing about what it sent. *Fixes:* you can read the tailoring prompt from the turn, and the turn
shows what it actually cost. This is [#15](https://github.com/Sandy-1711/whoami/issues/15).

Mastra passes `tracingContext.currentSpan` as the second argument to a tool's `execute`, and its
`traceId` and `id` are already OTel-shaped — 32 and 16 hex characters. So `tailor_plan` can build an
OTel parent context from them and run the pipeline call inside it; `@resume/llm`'s span then lands in
the same trace, under the tool. `markTraceRoots` needs no special case for it: the span has a real
parent now, so it stops being marked a root on its own.

**2. The tree is mostly plumbing.** Of 44 spans in one turn, 31 were Mastra internals — 17
`model_chunk`, 7 `model_inference`, 7 `model_step`. The eight that matter (the agent, two
generations, five tool calls) were buried. *Fixes:* the tool calls are visible without hunting.

Mastra's `excludeSpanTypes` takes the span types to drop. **Exclude `MODEL_CHUNK` and
`MODEL_INFERENCE`; do not exclude `MODEL_STEP`** — that distinction breaks the tree if it is got
wrong, because tool spans are parented to `model_step`:

```
invoke_agent → chat gemini-2.5-flash → model_step → score_jd        (TOOL)
                                                  → model_inference → model_chunk ×3
```

Drop `model_step` and every tool call's parent stops existing. The other two have only each other
below them, so dropping both is safe and takes a turn from 44 spans to about 20 with the structure
intact.

**3. Every trace has the same name.** Two rows called `Résumé Agent`, two called `tailor`. Nothing
said which was Serval and which was Katalyst. *Fixes:* the trace list becomes navigable.

Langfuse reads `langfuse.trace.name`, which `@mastra/langfuse` fills from a `traceName` metadata key,
set per turn through the agent's tracing options. **Decide rather than guess:** the company is not
known until `score_jd` or `tailor_plan` has run, so at turn start the only honest name is the
truncated opening message. That is the same problem `nameThread` already solved for threads — whatever
names the thread should probably name the trace, and this should reuse `packages/agent/src/titles.ts`
rather than grow a second answer.

**4. Getting from a turn to its trace is manual.** The status rail links to the Langfuse home page,
not to the trace for the turn on screen. *Fixes:* one click from an exchange to what it did.

Two unknowns to settle first. **Where the trace id comes from:** Mastra's chunk types carry an
`observability` field that has not been opened yet; if it holds the trace id, `relay.ts` can put it on
the `done` event. **How to build the URL:** a Langfuse trace URL is
`/project/<projectId>/traces/<traceId>`, and nothing in `AppConfig` knows the project id — only the
base URL. Either `LANGFUSE_PROJECT_ID` joins the config, or `GET /api/status` resolves it.

Do 1 and 2 first: both live in `packages/`, so they do not collide with studio work. 4 touches
`relay.ts`, `events.ts`, `useChat.ts` and `ChatPane.tsx`, so it wants a clear run at `apps/studio`.

### Phase 5, Phase 6, and three decisions

Phase 5 (formatter, linter, comment pass) and Phase 6 (deferred work) are written out at the bottom
of this file. Neither is next: the issues above are.

**Three open questions need a decision before they need work** — the file-drift half of the sources
lock, three pipeline tools that duplicate free CLI commands, and a tool description that promises a
confirm gate MCP does not have. They are at the end of this file, each with a recommendation.

---

## Working on this repo

**Restart the studio server after changing anything under `src/server/`.** `pnpm studio` runs
`tsx src/server/main.ts` with no watch, and Vite's middleware mode hot-reloads client modules only.
So a change to `src/web/` appears in the browser on save while a change to `src/server/` does not
appear at all — and the failure is silent: the pane simply behaves as though the feature was never
built. This cost a full misdiagnosis while building #9, where the browser had the new card code and
the server was still running a relay from two and a half hours earlier that sent no artifact events.

`tsx watch` was considered and rejected: it would restart the server on every save and kill in-flight
turns, which is worse for a chat server than remembering to restart.

**Watch the UI rather than curling it.** Playwright is already a dependency. Pointing it at the
running studio and screenshotting a pane is free, and it is what caught the artifact path bug — the
outputs route lists paths relative to `tailored/` while `tailor_render` returns them relative to the
repo root, so preview resolved to `/api/outputs/tailored/…` and would have 404'd while download
worked. Both tests and typecheck were green through that.

For anything that needs an answer on screen without spending credits, reopen a past thread — it
replays stored text — or mount a component with hand-built props on a throwaway Vite page under
`src/web/`, and delete it afterwards.

---

## Housekeeping

**#8 through #14 are still open on GitHub** even though the code is on `main`. #8's body states a
root cause that was checked against the running instance and does not hold — anyone reading it will
chase the wrong thing, so it wants a correcting comment more than it wants closing.

**`AGENT_BUILDLOG.md` at the repo root is stale and superseded** by this file — it opens by telling a
resuming chat to read it first, and describes a CLI flag (`resume tailor --coverage`) that no longer
exists. It should be deleted.

**Trace ids quoted in the issues and in [DECISIONS.md](DECISIONS.md) no longer resolve** — the
Langfuse instance was emptied to start fresh, as *Tracing* above notes.

---

## Open questions — the owner's call, not the plan's

Raised by an audit at the end of Phase 3, before there was an issue tracker. Still open, still the
owner's call: all three are things that exist without a reason strong enough to defend themselves.
They are questions rather than issues because each needs a decision before it needs work.

Question 2 has since been partly overtaken — the tailor tools it argues about are the subject of
[#17](https://github.com/Sandy-1711/whoami/issues/17), which proposes replacing them outright.

### 1. The file-drift half of `profile/sources.lock.json` earns nothing

The lock does two unrelated jobs. **Scrape freshness** (`recordScrape`, `lastScrape`, `isStale`,
`contentHash`) is load-bearing: it is the TTL short-circuit that stops every `sync` and every
`tailor_plan` re-hitting the GitHub API — N+1, one README call per repo across ~45 repos — and the
content hash that stops `github.json` being rewritten when nothing changed. Keep it.

**File drift** (`hashSources`, `sourceFiles`, `drift`, `writeLock`, `Lock.files`) is a warning
wired to nothing. All four call sites — `tailor/service.ts`, `email/service.ts`,
`outreach/service.ts`, `profile/status.ts` — print it or put it in a read-only status object.
Nothing gates, skips or branches on `d.synced` anywhere.

And the logic does not hold up: it detects "you edited `facts.json` or `resume.json` since the last
sync" and reports "your scraped sources may be stale" — but a hand edit to the fact base does not
make GitHub's data older. Its one real consumer is the model, which reads `drift` from
`profile_status` and is told by `sync_profiles`' description to re-scrape when it is set. So the
agent re-pulls GitHub because a local JSON file changed, and the sync's only real effect is
re-baselining the hash that was nagging it.

Cost of keeping: ~60 lines, a `files` key, and a meaningless warning at the top of every tailor,
email and outreach run. **Recommended: delete the file-drift half, keep the scrape half.**

Note in passing: Phase 3 changed the tracked key from `resume.tex` to `profile/resume.json` (the
`.tex` is generated now), and the committed lock still names the old key. Until the next `sync`,
drift reports `resume.json` as changed when nothing has — which is its own small argument.

### 2. Three of the five pipeline tools duplicate free CLI commands

`tailor_plan` and `tailor_render` are the only path to what they do — no CLI command tailors, by
design, and the skills' free path is a human writing the copy, which is narrower than a
whole-document rewrite validated line by line. Keep both.

`sync_profiles`, `build_resume` and `check_resume` are thin wrappers over exactly what
`pnpm sync`, `pnpm build:pdf` and `pnpm check` call. `job-copilot`'s own table already marks them
"same". Their only justification is an MCP client with no shell — Claude Desktop, Cursor. Driven
from Claude Code, where Bash exists, they are three of the eighteen tools a model has to choose
between, which is the exact complaint Phase 2 set out to fix.

**Recommended: drop all three if the MCP surface is only ever driven from a client with shell
access; keep them otherwise.** It is a one-line answer about how the toolkit is used, not a
technical question.

### 3. A tool description promises a confirm gate that MCP does not have

`runMcp` wires `confirm: allowGate`, which is `async () => true`. `tailor_plan`'s description says
"the user is asked before the run starts, because it costs credits". On the MCP path nobody is
asked by this codebase — it rests entirely on the client's own approval UI.

The gate itself is a known Phase 2 tradeoff and is written up there. The description claiming
otherwise is not: it is a statement that is false on one of the two paths that read it.
**Recommended: fix the wording either way this is decided.**

---

## Phase 5 — Formatter, linter, comment pass

**What:** Prettier + ESLint configured to match the existing style, enforced in CI, and a
comment pass across all packages.

**Why:** `lint` is currently just `tsc --noEmit`. Style should be enforced by tooling rather than
discipline. See [CONVENTIONS.md](CONVENTIONS.md).

**Scope grew in Phase 4.** `apps/studio` added a package of TSX that no existing config has an
opinion about, so this now covers React/JSX rules and Tailwind class order as well as the Node style
the other packages share. [#16](https://github.com/Sandy-1711/whoami/issues/16) also belongs here in
spirit — a comment pass is the natural moment to stop code comments naming the model.

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
