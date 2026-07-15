// `resume mcp` — expose the whole toolkit over the Model Context Protocol on
// stdio, so an external agent (Claude Code, Cursor, Claude Desktop) can call the
// résumé tools directly. The client spawns this as a subprocess and talks
// newline-delimited JSON-RPC over stdin/stdout.
//
// CRITICAL: stdout is the MCP wire. Nothing human-readable may touch it, or the
// protocol stream corrupts. main.ts redirects console.* to stderr before we build
// anything; here we also route tool progress to stderr. The stdio transport writes
// via process.stdout.write directly, so it is unaffected by the console redirect.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildMcpServer, progressPresenter, type AgentDeps } from '@resume/agent';
import type { Cli } from '../container.js';

function havePlaywright(root: string): boolean {
  return existsSync(join(root, 'node_modules', 'playwright'))
    || existsSync(join(root, 'packages', 'core', 'node_modules', 'playwright'));
}

export async function runMcp(cli: Cli): Promise<void> {
  const deps: AgentDeps = {
    root: cli.root,
    config: cli.config,
    registry: cli.registry,
    latex: cli.latex,
    pdf: cli.pdf,
    mailer: cli.mailer,
    // Progress goes to stderr — stdout is reserved for the JSON-RPC stream.
    presenter: progressPresenter((line) => process.stderr.write(line + '\n')),
    // The MCP client (e.g. Claude Code) prompts the user before every tool call,
    // so that prompt IS the human-in-the-loop for this path. Auto-approve the
    // in-tool confirm gate; without it, irreversible tools (send email, push
    // GitHub) would deadlock waiting on a terminal that isn't there.
    confirm: async () => true,
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
