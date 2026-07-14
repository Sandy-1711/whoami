// `resume chat` — the conversational front end. Builds the Mastra agent over the
// CLI's real adapters and runs a streaming REPL: your line goes to the agent,
// text streams back token by token, tool calls and progress render as dim lines,
// and the whole conversation persists to libSQL so the next session remembers it.
//
// Slash commands handle the things a chat line can't: multi-line JD entry, thread
// switching, and quick local views (status, facts) without a round-trip.
import { createInterface, type Interface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildAgent, progressPresenter, AGENT_RESOURCE_ID, type AgentDeps, type BuiltAgent,
} from '@resume/agent';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';
import { runStatus } from './status.js';

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

function buildDeps(cli: Cli, out: Out, ask: (q: string) => Promise<string>): AgentDeps {
  return {
    root: cli.root,
    config: cli.config,
    registry: cli.registry,
    latex: cli.latex,
    pdf: cli.pdf,
    mailer: cli.mailer,
    embedder: cli.embedder,
    presenter: progressPresenter((line) => out.line(pc.dim('  ' + line))),
    confirm: async (question: string) => {
      const a = (await ask('\n' + pc.yellow('? ') + question + pc.dim(' [y/N] '))).trim();
      return /^y(es)?$/i.test(a);
    },
    playwright: havePlaywright(cli.root),
  };
}

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

const HELP = `
  ${pc.bold('Slash commands')}
    ${pc.cyan('/help')}              show this
    ${pc.cyan('/new')}               start a fresh thread (clears the current conversation context)
    ${pc.cyan('/threads')}           list past threads and switch to one
    ${pc.cyan('/paste')}             paste multi-line text (a JD); attached to your next message
    ${pc.cyan('/jd')} <file>         attach a JD file's contents to your next message
    ${pc.cyan('/status')}            show studio status (keys, toolchain, sources, outputs)
    ${pc.cyan('/facts')}             show a quick summary of the fact base
    ${pc.cyan('/exit')}              quit
  ${pc.dim('Anything else is sent to the agent. It will call tools as needed.')}
`;

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

  let threadId = args.fresh ? randomUUID() : (await mostRecentThreadId(built)) ?? randomUUID();
  const resumed = !args.fresh && (await mostRecentThreadId(built)) === threadId;

  console.log(ui.kv('model', `${pc.cyan(built.model.label)} ${pc.dim(built.model.modelId)}`));
  console.log(ui.kv('memory', built.memory.semanticRecall
    ? pc.dim('threads + working memory + semantic recall')
    : pc.dim('threads + working memory (no recall — set a Gemini key)')));
  console.log(ui.kv('thread', resumed ? pc.dim(`resumed ${threadId.slice(0, 8)}`) : pc.dim(`new ${threadId.slice(0, 8)}`)));
  console.log(pc.dim(`  Type a message, or ${pc.bold('/help')} for commands. ${pc.bold('/exit')} to quit.\n`));

  // Read lines until a lone '.' — used for multi-line JD paste.
  async function readMultiline(): Promise<string> {
    out.line(pc.dim(`  Paste text; end with a single ${pc.bold('.')} on its own line.`));
    const lines: string[] = [];
    for (;;) {
      const l = await ask(pc.dim('… '));
      if (l.trim() === '.') break;
      lines.push(l);
    }
    return lines.join('\n').trim();
  }

  function factsSummary(): Promise<void> {
    return readFile(join(cli.root, 'profile', 'facts.json'), 'utf8').then((raw) => {
      const f = JSON.parse(raw);
      out.line(ui.heading('Fact base (profile/facts.json)'));
      out.line(ui.kv('name', pc.cyan(f.identity?.name ?? '?')));
      out.line(ui.kv('titles', pc.dim((f.title_variants ?? []).slice(0, 4).join(' · '))));
      out.line(ui.kv('experience', pc.dim(`${(f.experience ?? []).length} roles`)));
      out.line(ui.kv('projects', pc.dim(`${(f.projects ?? []).length} projects`)));
      out.line(ui.kv('keywords', pc.dim(`${(f.allowed_keywords ?? []).length} allowed`)));
      out.line(pc.dim('  Ask the agent (or use read_facts) for the full detail.'));
    }).catch(() => out.line(ui.fail('Could not read facts.json.')));
  }

  async function switchThread(): Promise<void> {
    const { threads } = await built.memory.memory.listThreads({
      filter: { resourceId: AGENT_RESOURCE_ID },
      orderBy: { field: 'updatedAt', direction: 'DESC' },
      perPage: 15,
    });
    if (!threads.length) { out.line(pc.dim('  No past threads yet.')); return; }
    out.line(ui.heading('Recent threads'));
    threads.forEach((t, i) => {
      const mark = t.id === threadId ? pc.green(' ← current') : '';
      out.line(`  ${pc.cyan(String(i + 1).padStart(2))}  ${t.title || pc.dim('(untitled)')}${mark}`);
    });
    const pick = (await ask(pc.dim('  Switch to # (Enter to stay): '))).trim();
    const idx = Number(pick);
    if (pick && Number.isInteger(idx) && idx >= 1 && idx <= threads.length) {
      threadId = threads[idx - 1]!.id;
      out.line(pc.dim(`  Switched to ${threadId.slice(0, 8)}.`));
    }
  }

  // A pending JD attachment (from /paste or /jd), folded into the next message.
  let attached = '';

  // Ctrl+C: cancel an in-flight turn if one is running, else exit the session.
  let active: AbortController | null = null;
  rl.on('SIGINT', () => {
    if (active) { active.abort(); active = null; out.line(pc.dim('  (cancelled)')); }
    else { out.line(''); rl.close(); }
  });

  let running = true;
  rl.on('close', () => { running = false; });

  while (running) {
    const raw = (await ask(pc.green('› '))).trim();
    if (!running) break;
    if (!raw) continue;

    // ---- slash commands ----------------------------------------------------
    if (raw.startsWith('/')) {
      const [cmd, ...rest] = raw.split(/\s+/);
      if (cmd === '/exit' || cmd === '/quit') break;
      else if (cmd === '/help') out.line(HELP);
      else if (cmd === '/new') { threadId = randomUUID(); out.line(pc.dim(`  New thread ${threadId.slice(0, 8)}.`)); }
      else if (cmd === '/threads') await switchThread();
      else if (cmd === '/status') await runStatus(cli).catch((e) => out.line(ui.fail((e as Error).message)));
      else if (cmd === '/facts') await factsSummary();
      else if (cmd === '/paste') {
        attached = await readMultiline();
        out.line(pc.dim(attached ? `  Attached ${attached.length} chars — included with your next message.` : '  Nothing pasted.'));
      } else if (cmd === '/jd') {
        const file = rest.join(' ').trim();
        if (!file || !existsSync(file)) out.line(ui.fail(`File not found: ${file || '(no path)'}`));
        else { attached = (await readFile(file, 'utf8')).trim(); out.line(pc.dim(`  Attached ${attached.length} chars from ${file}.`)); }
      } else out.line(ui.fail(`Unknown command: ${cmd}. Try /help.`));
      continue;
    }

    // ---- a message for the agent (fold in any attachment) ------------------
    const message = attached ? `${raw}\n\n<attached-jd>\n${attached}\n</attached-jd>` : raw;
    attached = '';

    active = new AbortController();
    try {
      await runTurn(built, message, threadId, out, active);
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
