// `resume mcp` — expose the whole toolkit over the Model Context Protocol on
// stdio, so an external agent (Claude Code, Cursor, Claude Desktop) can call the
// résumé tools directly. The client spawns this as a subprocess and talks
// newline-delimited JSON-RPC over stdin/stdout.
//
// CRITICAL: stdout is the MCP wire. Nothing human-readable may touch it, or the
// protocol stream corrupts. main.ts redirects console.* to stderr before we build
// anything; here we also route tool progress to stderr. The stdio transport writes
// via process.stdout.write directly, so it is unaffected by the console redirect.
import { buildMcpServer, progressPresenter, allowGate, type AgentDeps } from '@resume/agent';
import { havePlaywright } from '../adapters/playwright.js';
import type { Cli } from '../container.js';

export async function runMcp(cli: Cli): Promise<void> {
  const deps: AgentDeps = {
    root: cli.root,
    config: cli.config,
    llm: cli.llm,
    latex: cli.latex,
    pdf: cli.pdf,
    mailer: cli.mailer,
    // Progress goes to stderr — stdout is reserved for the JSON-RPC stream.
    presenter: progressPresenter((line) => process.stderr.write(line + '\n')),
    // The MCP client (Claude Code, Cursor, Claude Desktop) prompts the user with
    // the arguments before every tool call, so that prompt IS the
    // human-in-the-loop here. The in-tool gate has no terminal to reach on this
    // path — leaving it unanswered would hang the call — so it auto-approves and
    // the client's own approval stands in its place.
    //
    // Known limit: a client set to auto-approve loses the gate entirely. What
    // still holds on that path is the draft-first rule — send_application_email
    // can only transmit bytes that a previous drafting call wrote under
    // tailored/, and that call showed them.
    confirm: allowGate,
    playwright: havePlaywright(cli.root),
  };

  const server = buildMcpServer(deps);

  // Shut the transport down cleanly on a termination signal. We do NOT close on
  // stdin 'close' — the stdio transport owns that lifecycle (it ends on the
  // client's EOF and lets the event loop drain), and closing it ourselves would
  // race an in-flight tool call and drop its response.
  const shutdown = (): void => { server.close().finally(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.startStdio();
  // startStdio resolves once connected; the transport keeps reading stdin, which
  // holds the process open for the whole session and tears down on client EOF.
  process.stderr.write('résumé MCP server ready (stdio) — waiting for a client.\n');
}
