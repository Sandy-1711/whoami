# The studio

A local web surface for the same agent `resume chat` runs. It exists because a terminal is a poor
place to review generated copy, approve a send, or see what a turn actually did — and because the
résumé and the conversation that changes it belong on screen together.

```sh
pnpm studio                 # http://127.0.0.1:4321
pnpm studio -- --port 5000  # if 4321 is taken
```

It binds `127.0.0.1` and nothing else. The routes read and write the repo, spawn LaTeX, and reach a
model on your key.

## What it is made of

One process on one port. `/api` is [Hono](https://hono.dev) over the CLI's container
(`buildCli()` from `@resume/cli`); everything else is a React SPA served by Vite in **middleware
mode**, so there is no build step between editing a component and reloading — the same call Phase 2
made when it dropped the MCP bundle in favour of running the source under `tsx`.

```
apps/studio/src/
  server/      Hono routes, the SSE turn, the two gates          (NodeNext)
  web/         the SPA                                            (bundler + JSX)
  shared/      the wire format both halves import                 (both)
```

Nothing about the agent is re-implemented here. `assembleTools(deps)` is still the single source of
truth for what tools exist, and the studio wires exactly that set — so a tool added for chat appears
here without being mentioned.

## The panes

| Pane | What it is for |
| --- | --- |
| threads | past conversations, out of the same libSQL store `resume chat` resumes from |
| status | `collectStatus` as a rail — keys, toolchain, source freshness, outputs — plus a link to Langfuse |
| chat | the turn: reasoning, the tool timeline, the answer |
| résumé | `profile/resume.json` as fields; save re-renders `resume.tex`, build compiles the PDF |
| pdf | the canonical render, or anything under `tailored/` |

The **tool timeline** is the thing a terminal cannot keep. Each call stays on screen after the turn
ends, expands to the arguments it ran with, and carries the wall-clock time it took.

A **JD is attached as a file**, not pasted. The upload lands under `.agent/jd/` and the path is what
reaches the agent, because every JD-taking tool accepts `jdPath`.

## Approvals

The confirm gate is unchanged from Phase 2 — `ConfirmGate` is still
`(request: ConfirmRequest) => Promise<boolean>`, carrying the resolved values rather than a sentence
about them. Only the transport is new: the request goes out on the turn's SSE stream, the modal
renders those fields, and the browser's POST settles the promise the tool is awaiting.

Everything that is not an answer means refused — a timeout, a closed tab, a stream that died.
`ask_user` behaves the same way except that going unanswered throws, so the model is told nobody
answered rather than handed blank preferences it would treat as chosen.

This is the only one of the three front ends where the gate is both shown and answered by this
codebase. Chat prompts a terminal; MCP delegates to the client's own approval UI.

## Routes

| Route | Purpose |
| --- | --- |
| `POST /api/chat` | one turn, as an SSE stream. Closing it cancels the run. |
| `POST /api/confirm/:id`, `/api/ask/:id` | settle a request the turn is blocked on |
| `GET /api/threads`, `/api/threads/:id` | past threads and their transcript |
| `GET`/`PUT /api/resume` | the document — `parseResume` validates the PUT, `writeResumeTex` follows it |
| `POST /api/resume/build` | render, compile, run the guards; returns the log either way |
| `GET /api/resume.pdf`, `/api/outputs`, `/api/outputs/*` | the canonical render and the tailored ones |
| `POST /api/files` | store a JD, return a path usable as `jdPath` |
| `GET /api/status` | `collectStatus`, plus where Langfuse is |

## Costs

The same rule as everywhere else: a chat turn spends credits, and so does any drafting tool the
agent decides to call. Everything the panes do on their own — status, threads, reading and writing
the document, compiling, listing outputs — is free.
