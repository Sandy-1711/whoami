# Conventions

How code in this repo is written. Enforced by tooling where possible (Phase 5), by review
otherwise.

## Comments

- Write one only when the code cannot say it itself: a caveat, a unit, a reason something
  non-obvious is done that way.
- Never restate the signature.
- Never record history — no "used to", "previously", "now does X instead".
- Never say the same thing in two places.
- **Keep doc comments on exported/public API.** That is the hover text a consumer reads in their
  editor; removing it degrades the thing they actually care about.
- Watch doc-comment binding: a `/** */` block attaches to the *next* declaration, so a file-header
  written that way silently becomes the docs for whatever follows. Invisible in source, obvious in
  editor hover. Use `//` for file headers.

**Comment density is a misleading metric** — it counts good API docs and clutter identically. Judge
every comment on its own. Real caveats worth keeping already exist in this repo: the stdout/JSON-RPC
warning in `apps/cli/src/commands/mcp.ts`, the raw-mode note above `pasteJd` in
`apps/cli/src/main.ts`.

## Structure

- Readable over clever. Short functions, shallow nesting, no dense one-liners.
- Same concept, same name everywhere.
- Keep sibling modules structurally parallel — a reader who knows one should be able to predict the
  next.
- Share code that is genuinely identical. Do not merge things that only look alike.

## Tooling

- Prettier and ESLint configured to match the existing style, enforced in CI.
- Every disabled lint rule carries a one-line reason.

## Commits

- One concern per commit, landed continuously while building rather than as one commit at the end.
- **Stage only the files that concern touches.** If a file did not need to change for this concern,
  it does not belong in this commit.
- Infrastructure, each fix, and each test area land separately. A source fix goes in its own commit
  ahead of the tests that prove it.
- Each commit is self-consistent — a lockfile change belongs with the manifest that caused it.
- Explain *why* in the body, not just what.
- Formatting changes go in their own commit.
- Write the message with a heredoc (`git commit -F - <<'EOF'`). A PowerShell here-string
  (`@'…'@`) is not shell syntax in the Bash tool: it leaves a literal `@` as line one, which
  silently becomes the commit subject.


The repo is worked in parallel from another terminal. Re-read
`git rev-parse --abbrev-ref HEAD` before committing rather than trusting the branch from earlier in
the session, and re-check `origin/main` before assuming a branch is still based on it. Never stash
uncommitted work without saying so prominently.
