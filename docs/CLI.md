# The `resume` CLI

One entrypoint (`apps/cli/src/main.ts`): reach the agent, keep your GitHub facts
fresh, send a drafted email, build the canonical PDF, and run the guards that CI
also runs.

Anything that needs a model — tailoring, drafting, research — belongs to the
agent, not to a command. `chat` and `mcp` are how you get to it. What is left
here is what is worth having without one: the toolchain, the free deterministic
reads, and putting an already-written email on the wire.

Run it via the workspace scripts in [package.json](../package.json), or directly
with `pnpm --filter @resume/cli exec tsx src/main.ts <command>`.

```
pnpm resume            # interactive menu
pnpm resume <command>  # e.g. pnpm resume status
```

## Interactive menu

Running `resume` with no command (`pnpm resume`) opens a menu built with
`@clack/prompts` that walks you through the commands below — useful when you
don't remember the flags. Each action returns to the menu until you choose Exit.

> **One toolkit, two surfaces.** `chat` and `mcp` expose every capability as a
> tool for an agent to call. The remaining commands are the operator's: they
> spend nothing, need no conversation, and several of them run in CI.

## Commands

### `chat` — conversational agent (every capability as a tool)

```
resume chat [--new]
```

Opens a streaming chat with the job-search agent (Mastra + Gemini/DeepSeek). It has all the
toolkit's capabilities as tools — scoring, tailoring, drafting/sending email, application notes,
syncing, building, updating facts, and more — and calls them for you. Text streams back; tool
calls and progress show as dim lines; `Ctrl+C` cancels the current turn without quitting.

Memory persists across sessions (libSQL under `.agent/`, gitignored): past threads, a
working-memory scratchpad (active applications, preferences), and — **opt-in** — semantic
recall (`AGENT_RECALL=1` + a Gemini key; it embeds every message before the chat model is
called, so it's off by default to keep turns snappy). A thread is titled after the company
a tool named, or else after the request that opened it — no model, no spend. By default it
resumes your most recent thread; `--new` starts fresh.

Answers render markdown in the terminal — headers, **bold**, bullets, inline code, fenced
blocks — and tool calls show a glyph plus elapsed time (`✓ score_jd 0.8s`). Set
`RESUME_PLAIN=1` (or pipe the output) for raw unstyled text.

Slash commands: `/help`, `/new`, `/threads` (list + switch), `/model` (switch the chat model
for this session), `/usage` (token usage, est. spend, context-window status), `/paste`
(multi-line JD), `/jd <file>` (attach a JD file to the next message), `/status`, `/facts`, `/exit`.

After every turn a dim status line reports the model, how full the context window is
(last prompt tokens / window), tokens moved (↑ in / ↓ out), and estimated spend for the
turn and the session. Prices are approximate public list prices for local display only —
not billing. `/model` only offers providers that have a key; switching keeps the current
thread and running usage totals.

Configure the agent with `AGENT_PROVIDER` / `AGENT_MODEL` (see `.env.example`). The **provider**
resolves `AGENT_PROVIDER` → **Gemini whenever a Gemini key is set** → `LLM_PROVIDER` → first key.
Chat wants low time-to-first-token, so it no longer inherits an `LLM_PROVIDER=deepseek` meant
for the pipelines — set `AGENT_PROVIDER=deepseek` explicitly to chat on DeepSeek. The **model**
is decoupled too: it defaults to a fast, cheap chat model (`gemini-2.5-flash`), *not* the
`GEMINI_MODEL` the pipelines use. Set `AGENT_MODEL` to override (e.g. `gemini-2.5-pro` for
depth, `deepseek-reasoner` to stream DeepSeek's reasoning). `/model` overrides both for the
running session.

### `mcp` — serve the tools over MCP (for Claude Code / Cursor / Claude Desktop)

```
resume mcp        # or: pnpm mcp
```

Exposes the **same tools the `chat` agent uses** over the [Model Context Protocol](https://modelcontextprotocol.io)
on stdio, so an external agent can call them directly — score a JD, tailor and build the résumé,
draft/send outreach, read and edit the fact base, refresh scraped sources, and track applications.
It's a pure tool provider: no model, no chat memory — the connecting client (e.g. Claude Code)
brings the model and decides which tools to call.

The repo ships a project-scoped [`.mcp.json`](../.mcp.json), so **Claude Code auto-discovers the
server** when you open this repo — just approve it (`/mcp` to check status). For other clients, point
them at `node --import tsx apps/cli/src/main.ts mcp` (working directory = repo root) — that is what
`.mcp.json` runs, and it is deliberately one process rather than going through `pnpm`, which added a
launch chain in front of every session. Env (`GEMINI_API_KEY`, `GMAIL_*`, …)
is read from `.env` at the repo root exactly like the CLI — nothing to configure per client.

- **Transport:** stdio. `stdout` carries the JSON-RPC stream; all logs/progress go to `stderr`.
- **Confirms:** anything that spends credits, leaves the machine, or rewrites the grounding stops
  at a human confirm in `chat`, and the prompt shows the resolved call — for a send, the recipient,
  where that address came from, the subject, the attachment and the whole body. Over MCP that gate
  auto-approves, because the MCP client prompts you before each tool call — that prompt is the
  human-in-the-loop. Approve sends/pushes deliberately; declining the client's prompt is how you
  say no. What holds even under "always allow" is that `send_application_email` can only transmit
  bytes an earlier drafting call wrote under `tailored/`.
- **Cost:** the pipeline/draft tools call the LLM (Gemini/DeepSeek) and spend credits when invoked,
  just as they do from the CLI. The read-only tools (`score_jd`, `profile_status`, `read_profile`,
  `list_outputs`, `list_applications`) are free.
- **Policy for agents:** if the deliverable is *text* (résumé content, emails, notes), the
  MCP client should draft it itself — grounded in `read_profile` — and
  use the free/local tools to apply, build, check, and send. Reserve the paid drafting tools
  for when the user explicitly asks. (The `.claude/skills/job-copilot` skill spells this out.)

### `send` — mail a saved application email (free)

```
resume send --company "Acme AI" [--path <draft>] [--to <addr>] [--attach <pdf>|--no-attach] [--dry-run]
```

Sends `tailored/<company>/application-email.txt` **exactly as written**. No model runs
here: the draft came from the agent (`draft_application_email`), from a Claude Code
session, or from your own editor, and this command shows it, confirms the recipient,
and puts it on the wire.

The file's shape is an optional `To:` line, a `Subject:` line, a blank line, then the
body. Sending goes through Gmail with a **Google App Password** (`GMAIL_USER` +
`GMAIL_APP_PASSWORD` in `.env`).

| Flag | Description |
|---|---|
| `--company` (alias `--name`) | which draft to send — names the folder under `tailored/` |
| `--path <file>` | send a specific draft file instead of the one filed under the company |
| `--to <addr>` | set/override the recipient (else the draft's own `To:` header) |
| `--attach <pdf>` / `--no-attach` | attach a specific PDF, or nothing; the default is the newest PDF sitting beside the draft |
| `--dry-run` (alias `--no-send`) | show it and stop |

**Tailoring, drafting and research are not commands.** They live with the agent — `resume
chat`, or the MCP tools in any client — because they need a conversation to be worth
anything: which angle to lead with, what the user thought of the last draft, what the
company actually builds. See [`tailor_plan` / `tailor_render`, `outreach_message`,
`draft_application_email`](#mcp--serve-the-tools-over-mcp-for-claude-code--cursor--claude-desktop).

### `score` — deterministic JD fit check (free)

```
resume score <path/to/jd.txt>
resume score --jd "paste JD text…"
```

The same scorer the tailor pipeline uses, unbundled: extracts JD keywords from the
lexicon, classifies them against `profile/resume.json` + `profile/facts.json`, and prints the
before/after ATS score with the matched/addable/missing chips. **No LLM, no PDF, no
network, no cost** — use it to decide whether a role is worth a full tailor run.
Same check over MCP: the `score_jd` tool.

### `digest` — ranked profile evidence (free)

```
resume digest [--json]
```

Prints the deterministic **profile digest**: top GitHub repos (curation pins first;
forks, archived, and banned repos excluded; ranked by stars/recency/description, cap 8),
external contributions with merged-PR counts and sample titles (cap 5), and one line per
LinkedIn role. This is exactly the evidence block injected into the drafting prompts
(tailor/email/outreach/note) — `facts.json` remains the only source of claims.
`--json` emits the structured form. Output is plain (no banner) so agents can consume it.
Same data over MCP: `read_profile` (whole) or `read_profile` scoped to `evidence`.

### `sync` — refresh scraped profile sources

```
resume sync [--force] [--linkedin]
```

Re-scrapes GitHub into `profile/github.json` when stale (see `SCRAPE_TTL_HOURS`), then
re-baselines the drift hashes in `profile/sources.lock.json` so tailoring won't nag about
stale facts afterward. `--force` ignores the freshness TTL and re-scrapes unconditionally.

**LinkedIn is opt-in:** `profile/linkedin.json` is refreshed only when you pass
`--linkedin` (scraping LinkedIn is against its ToS, so it never runs implicitly).
Its structuring step calls Gemini; GitHub-only sync is LLM-free.

Manual edits to `profile/github.json` / `profile/linkedin.json` persist until
the next scrape changes that specific field.

**Repo curation** — `profile/curation.json` is a hand-maintained file (`sync` never
overwrites it) with two lists: `pin` (repos to surface first, in order) and `ban`
(repos to hide everywhere). It's applied when `sync` writes `profile/github.json` —
banned repos are dropped (and excluded from repo/star totals), pinned ones float to
the front — and again whenever a prompt reads the scrape, so an edit takes effect even
before the next sync. Own repos match by name (`Web-Aware-Rag-Engine`); external
contributions by full `owner/name` (`mastra-ai/mastra`). Case-insensitive.

### `status` — one-screen health check

```
resume status
```

Shows, at a glance ([apps/cli/src/commands/status.ts](../apps/cli/src/commands/status.ts)):
- **Environment** — which LLM providers have a key (and which is active), GitHub token set?, LinkedIn live-scrape readiness (cookie + Playwright).
- **LaTeX toolchain** — whether `latexmk` or a running Docker daemon is available to render.
- **Scraped sources** — GitHub/LinkedIn freshness and whether they've drifted since the last `sync`.
- **Canonical résumé** — whether `apps/web/assets/resume.pdf` is built, its size and age.
- **Tailored outputs** — the most recent tailored PDFs on disk.

### `build` — compile the canonical résumé

```
resume build
```

Thin wrapper over `apps/cli/src/build-pdf.ts`: renders `profile/resume.json` to
`resume.tex`, then compiles it to `apps/web/assets/resume.pdf`, mirroring what CI
does. Needs `latexmk` locally or a running Docker daemon.

### `check` — run the guards

```
resume check [--source|--pdf|--width]
```

Thin wrapper over `apps/cli/src/check-resume.ts`. With no flag it runs every guard;
otherwise it scopes to one:

| Flag | Checks |
|---|---|
| `--source` | `resume.tex` structure (required sections, balanced macros), and that it is still what `profile/resume.json` renders to |
| `--pdf` | the built PDF is exactly one page |
| `--width` | the LaTeX build log for overfull `\hbox` warnings (layout overflow) |

## Environment variables

Set these in `.env` at the repo root (copy from [.env.example](../.env.example); `.env` is gitignored):

| Variable | Required | Purpose |
|---|---|---|
| `LLM_PROVIDER` | no | default provider id for the pipelines (`gemini` / `deepseek`); else whichever key is set (Gemini first) |
| `GEMINI_API_KEY` | one LLM key | Google Gemini API key |
| `GEMINI_MODEL` | no | Gemini model override for the pipelines, default `gemini-2.5-flash` |
| `DEEPSEEK_API_KEY` | one LLM key | DeepSeek API key (OpenAI-compatible) |
| `DEEPSEEK_MODEL` | no | DeepSeek model override, default `deepseek-chat` |
| `AGENT_PROVIDER` | no | provider for the `chat` agent (`gemini` / `deepseek`); blank → Gemini when keyed, else `LLM_PROVIDER`, else first key |
| `AGENT_MODEL` | no | chat model override; blank → the fast chat default (`gemini-2.5-flash`), **not** the `GEMINI_MODEL` pipeline model |
| `AGENT_EMBEDDING_MODEL` | no | embedding model for chat semantic recall (default `gemini-embedding-001`); needs a Gemini key |
| `AGENT_RECALL` | no | `1`/`true` enables chat semantic recall (an embedding round-trip per turn); off by default |
| `RESUME_PLAIN` | no | `1` disables the chat's terminal markdown rendering (raw text) |
| `GITHUB_TOKEN` | no | raises the GitHub API rate limit for `sync`; public scrape works without it |
| `SCRAPE_TTL_HOURS` | no | hours before a scraped source is considered stale (default 12) |
| `LINKEDIN_COOKIE` | no | `li_at` session cookie to enable live LinkedIn scraping via Playwright; without it, `sync` falls back to parsing `Linkedin_Profile.pdf` in the repo root |

## Related workspace scripts

`build`/`check` above are thin wrappers; these run the same underlying scripts directly:

```
pnpm build:pdf     # apps/cli/src/build-pdf.ts
pnpm check         # apps/cli/src/check-resume.ts (all guards)
pnpm check:source  # --source (structure only, no LaTeX needed)
pnpm check:pdf     # --pdf
pnpm check:width   # --width
pnpm verify        # build:pdf then check
```

## Adding an LLM provider

Because the providers sit behind a registry, adding one is two steps:

1. Write `packages/core/src/llm/providers/<name>.ts` exporting an `LlmProviderFactory`
   (`id`, `label`, `apiKeyEnv`, `modelEnv`, `defaultModel`, and `create()`).
2. Register it in the composition root: `apps/cli/src/container.ts` → `.register(<name>Factory)`.

No changes to the tailor pipeline, scrapers, `status`, or config are needed.

## See also

- [apps/cli/src/main.ts](../apps/cli/src/main.ts) — entrypoint and command dispatch
- [apps/cli/src/container.ts](../apps/cli/src/container.ts) — composition root (adapters + provider registry)
- [apps/cli/src/args.ts](../apps/cli/src/args.ts) — argv parsing rules (flag vs. positional)
- The `resume-tailor` and `resume-ats` skills for the tailoring pipeline and ATS keyword scoring in more depth
