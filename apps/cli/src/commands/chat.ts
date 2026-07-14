// `resume chat` — the conversational front end. Builds the Mastra agent over the
// CLI's real adapters and runs a streaming REPL: your line goes to the agent,
// text streams back token by token, tool calls and progress render as dim lines,
// and the whole conversation persists to libSQL so the next session remembers it.
//
// Slash commands and richer input (multi-line paste, JD files) are layered on in
// a follow-up; this is the core loop: stream, tool events, thread resume, cancel.
import { createInterface, type Interface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildAgent, progressPresenter, AGENT_RESOURCE_ID, type AgentDeps, type BuiltAgent,
} from '@resume/agent';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

function havePlaywright(root: string): boolean {
  return existsSync(join(root, 'node_modules', 'playwright'))
    || existsSync(join(root, 'packages', 'core', 'node_modules', 'playwright'));
}

// A tiny stdout coordinator so streamed text (written without newlines) and
// full-line notices (tool events, progress) never collide mid-line.
interface Out {
  atLineStart: boolean;
  text(s: string): void;
  line(s: string): void;
}
function makeOut(): Out {
  return {
    atLineStart: true,
    text(s: string) { if (!s) return; process.stdout.write(s); this.atLineStart = s.endsWith('\n'); },
    line(s: string) { if (!this.atLineStart) process.stdout.write('\n'); console.log(s); this.atLineStart = true; },
  };
}

function compactArgs(args: unknown): string {
  try {
    const s = JSON.stringify(args ?? {});
    return s.length > 80 ? s.slice(0, 77) + '…}' : s;
  } catch { return ''; }
}

// Build the agent's deps from the CLI container, wiring the confirm gate and the
// progress sink to this REPL's terminal.
function buildDeps(cli: Cli, out: Out, ask: (q: string) => Promise<string>): AgentDeps {
  return {
    root: cli.root,
    config: cli.config,
    registry: cli.registry,
    latex: cli.latex,
    pdf: cli.pdf,
    mailer: cli.mailer,
    presenter: progressPresenter((line) => out.line(pc.dim('  ' + line))),
    confirm: async (question: string) => {
      const a = (await ask('\n' + pc.yellow('? ') + question + pc.dim(' [y/N] '))).trim();
      return /^y(es)?$/i.test(a);
    },
    playwright: havePlaywright(cli.root),
  };
}

// Most recent thread for the resource, or null if none exist yet.
async function mostRecentThreadId(built: BuiltAgent): Promise<string | null> {
  try {
    const { threads } = await built.memory.memory.listThreads({
      filter: { resourceId: AGENT_RESOURCE_ID },
      orderBy: { field: 'updatedAt', direction: 'DESC' },
      perPage: 1,
    });
    return threads[0]?.id ?? null;
  } catch { return null; }
}

// Stream one turn, rendering text + tool events. Ctrl+C aborts just this turn.
async function runTurn(built: BuiltAgent, input: string, threadId: string, out: Out, abort: AbortController): Promise<void> {
  const res = await built.agent.stream(input, {
    memory: { thread: threadId, resource: AGENT_RESOURCE_ID },
    maxSteps: 16,
    abortSignal: abort.signal,
  });

  for await (const chunk of res.fullStream as AsyncIterable<{ type: string; payload: any }>) {
    switch (chunk.type) {
      case 'text-delta':
        out.text(chunk.payload.text);
        break;
      case 'tool-call':
        out.line(pc.dim(`  ⚙ ${chunk.payload.toolName} ${compactArgs(chunk.payload.args)}`));
        break;
      case 'tool-result':
        out.line(pc.dim(`  ✓ ${chunk.payload.toolName}${chunk.payload.isError ? pc.red(' (error)') : ''}`));
        break;
      case 'error':
        out.line(ui.fail(String(chunk.payload?.error?.message ?? chunk.payload?.error ?? chunk.payload)));
        break;
    }
  }
  out.line('');
}

export interface RunChatArgs {
  fresh?: boolean;   // start a new thread instead of resuming the last one
}

export async function runChat(cli: Cli, args: RunChatArgs = {}): Promise<void> {
  console.log(ui.banner('résumé chat', 'your job-search copilot — every capability as a tool'));

  const out = makeOut();
  const rl: Interface = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

  let built: BuiltAgent;
  try {
    built = buildAgent(buildDeps(cli, out, ask));
  } catch (err) {
    rl.close();
    console.log('\n' + ui.fail((err as Error).message) + '\n');
    return;
  }

  const threadId = args.fresh ? randomUUID() : (await mostRecentThreadId(built)) ?? randomUUID();
  const resumed = !args.fresh && threadId !== undefined && (await mostRecentThreadId(built)) === threadId;

  console.log(ui.kv('model', `${pc.cyan(built.model.label)} ${pc.dim(built.model.modelId)}`));
  console.log(ui.kv('memory', built.memory.semanticRecall
    ? pc.dim('threads + working memory + semantic recall')
    : pc.dim('threads + working memory (no recall — set a Gemini key)')));
  console.log(ui.kv('thread', resumed ? pc.dim(`resumed ${threadId.slice(0, 8)}`) : pc.dim(`new ${threadId.slice(0, 8)}`)));
  console.log(pc.dim(`  Type your message. ${pc.bold('/exit')} to quit.\n`));

  // Ctrl+C: cancel an in-flight turn if one is running, else exit the session.
  let active: AbortController | null = null;
  rl.on('SIGINT', () => {
    if (active) { active.abort(); active = null; out.line(pc.dim('  (cancelled)')); }
    else { out.line(''); rl.close(); }
  });

  let running = true;
  rl.on('close', () => { running = false; });

  while (running) {
    const line = (await ask(pc.green('› '))).trim();
    if (!running) break;
    if (!line) continue;
    if (line === '/exit' || line === '/quit') break;

    active = new AbortController();
    try {
      await runTurn(built, line, threadId, out, active);
    } catch (err) {
      if (active?.signal.aborted) out.line(pc.dim('  (cancelled)'));
      else out.line('\n' + ui.fail((err as Error).message));
    } finally {
      active = null;
    }
  }

  rl.close();
  console.log(pc.dim('\nBye 👋\n'));
}
