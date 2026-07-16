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
  CHAT_MODELS, chatModelInfo, estimateCost, keyedAgentProviders,
  type AgentProviderId, type ChatModelInfo,
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

// ---- usage + cost accounting ---------------------------------------------
// Token usage reported for a single turn (aggregate across the turn's steps).
interface TurnUsage { inputTokens: number; outputTokens: number; }
// Running totals for the whole chat session.
interface Session { turns: number; inputTokens: number; outputTokens: number; cost: number; lastContextTokens: number; }

function fmtInt(n: number): string { return n.toLocaleString('en-US'); }
// Compact token count for the context gauge: 32k, 1.0M, 512.
function fmtShort(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}
function fmtCost(n: number): string { return n >= 0.01 ? '$' + n.toFixed(2) : '$' + n.toFixed(4); }

// The dim one-liner shown after each turn: which model, how full the context
// window is (last prompt tokens / window), tokens moved, and est. spend.
function usageLine(info: ChatModelInfo, u: TurnUsage, turnCost: number, s: Session): string {
  const used = s.lastContextTokens;
  const pct = info.contextWindow > 0 ? Math.round((used / info.contextWindow) * 100) : 0;
  const priced = info.inputPer1M > 0 || info.outputPer1M > 0;
  const ctx = `ctx ${pct}% (${fmtShort(used)}/${fmtShort(info.contextWindow)})`;
  const tok = `↑${fmtInt(u.inputTokens)} ↓${fmtInt(u.outputTokens)}`;
  const money = priced ? `turn ${fmtCost(turnCost)} · session ${fmtCost(s.cost)}` : 'cost n/a';
  return pc.dim(`  ${info.modelId} · ${ctx} · ${tok} · ${money}`);
}

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

async function runTurn(built: BuiltAgent, input: string, threadId: string, out: Out, abort: AbortController): Promise<TurnUsage> {
  const res = await built.agent.stream(input, {
    memory: { thread: threadId, resource: AGENT_RESOURCE_ID },
    maxSteps: 16,
    abortSignal: abort.signal,
    // Ask Gemini to stream its thought summaries so the model's reasoning shows
    // live as dim text instead of leaving a dead pause before the answer.
    // Namespaced under `google`, so non-Google providers simply ignore it.
    providerOptions: { google: { thinkingConfig: { includeThoughts: true } } },
  });

  let thinking = false; // currently rendering a dim reasoning block
  const endThinking = (): void => { if (thinking) { out.line(''); thinking = false; } };
  // Aggregate token usage, reported once on the terminal 'finish' chunk.
  const usage: TurnUsage = { inputTokens: 0, outputTokens: 0 };

  for await (const chunk of res.fullStream as AsyncIterable<{ type: string; payload: any }>) {
    switch (chunk.type) {
      case 'reasoning-delta': {
        const t: string = chunk.payload?.text ?? '';
        if (!t) break;
        if (!thinking) { out.line(pc.dim(pc.italic('  💭 thinking…'))); thinking = true; }
        out.text(pc.dim(t));
        break;
      }
      case 'reasoning-end':
        endThinking();
        break;
      case 'text-delta':
        endThinking();
        out.text(chunk.payload.text);
        break;
      case 'tool-call':
        endThinking();
        out.line(pc.dim(`  ⚙ ${chunk.payload.toolName} ${compactArgs(chunk.payload.args)}`));
        break;
      case 'tool-result':
        out.line(pc.dim(`  ✓ ${chunk.payload.toolName}${chunk.payload.isError ? pc.red(' (error)') : ''}`));
        break;
      case 'finish': {
        // FinishPayload.output.usage carries the turn's aggregate token counts.
        const u = chunk.payload?.output?.usage;
        if (u) { usage.inputTokens = u.inputTokens ?? 0; usage.outputTokens = u.outputTokens ?? 0; }
        break;
      }
      case 'error':
        endThinking();
        out.line(ui.fail(String(chunk.payload?.error?.message ?? chunk.payload?.error ?? chunk.payload)));
        break;
    }
  }
  endThinking();
  out.line('');
  return usage;
}

const HELP = `
  ${pc.bold('Slash commands')}
    ${pc.cyan('/help')}              show this
    ${pc.cyan('/new')}               start a fresh thread (clears the current conversation context)
    ${pc.cyan('/threads')}           list past threads and switch to one
    ${pc.cyan('/model')}             list models and switch the chat model for this session
    ${pc.cyan('/usage')}             show token usage, est. spend, and context-window status
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

  const deps = buildDeps(cli, out, ask);
  let built: BuiltAgent;
  try {
    built = buildAgent(deps);
  } catch (err) {
    rl.close();
    console.log('\n' + ui.fail((err as Error).message) + '\n');
    return;
  }

  // Running usage totals for the session (survive /model switches; reset by nothing).
  const session: Session = { turns: 0, inputTokens: 0, outputTokens: 0, cost: 0, lastContextTokens: 0 };

  const recent = args.fresh ? null : await mostRecentThreadId(built);
  let threadId = recent ?? randomUUID();
  const resumed = Boolean(recent);

  const modelLine = (): string => {
    const info = chatModelInfo(built.model.modelId, built.model.providerId as AgentProviderId);
    return `${pc.cyan(built.model.label)} ${pc.dim(built.model.modelId)} ${pc.dim(`· ${fmtShort(info.contextWindow)} ctx`)}`;
  };
  console.log(ui.kv('model', modelLine()));
  console.log(ui.kv('memory', built.memory.semanticRecall
    ? pc.dim('threads + working memory + semantic recall')
    : pc.dim('threads + working memory (recall off — AGENT_RECALL=1 + a Gemini key enables it)')));
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

  // /model — pick a chat model from the catalog (only providers with a key are
  // offered) and rebuild the agent, reusing the open memory so the thread carries
  // over. Session usage totals persist across the switch.
  async function switchModel(): Promise<void> {
    const keyed = keyedAgentProviders(cli.config);
    const models = CHAT_MODELS.filter((m) => keyed.includes(m.providerId));
    if (!models.length) { out.line(pc.dim('  No keyed providers — set a Gemini or DeepSeek key in .env.')); return; }
    out.line(ui.heading('Models'));
    models.forEach((m, i) => {
      const mark = m.modelId === built.model.modelId ? pc.green(' ← current') : '';
      const price = m.inputPer1M > 0 ? pc.dim(`  $${m.inputPer1M}/$${m.outputPer1M} per 1M · ${fmtShort(m.contextWindow)} ctx`) : '';
      out.line(`  ${pc.cyan(String(i + 1).padStart(2))}  ${m.label}${price}${mark}`);
    });
    const pick = (await ask(pc.dim('  Switch to # (Enter to stay): '))).trim();
    const idx = Number(pick);
    if (!pick || !Number.isInteger(idx) || idx < 1 || idx > models.length) return;
    const chosen = models[idx - 1]!;
    if (chosen.modelId === built.model.modelId) { out.line(pc.dim('  Already on that model.')); return; }
    try {
      built = buildAgent(deps, { modelOverride: { providerId: chosen.providerId, modelId: chosen.modelId }, memory: built.memory });
      out.line(pc.dim('  Now using ') + modelLine());
    } catch (err) {
      out.line(ui.fail((err as Error).message));
    }
  }

  // /usage — the session's token + spend report, plus the context-window gauge.
  function showUsage(): void {
    const info = chatModelInfo(built.model.modelId, built.model.providerId as AgentProviderId);
    const used = session.lastContextTokens;
    const pct = info.contextWindow > 0 ? Math.round((used / info.contextWindow) * 100) : 0;
    out.line(ui.heading('Session usage'));
    out.line(ui.kv('model', modelLine()));
    out.line(ui.kv('context', pc.dim(`${pct}% used — ${fmtInt(used)} / ${fmtInt(info.contextWindow)} tokens (last turn's prompt)`)));
    out.line(ui.kv('turns', pc.dim(String(session.turns))));
    out.line(ui.kv('tokens', pc.dim(`↑ ${fmtInt(session.inputTokens)} in · ↓ ${fmtInt(session.outputTokens)} out · ${fmtInt(session.inputTokens + session.outputTokens)} total`)));
    if (info.inputPer1M > 0 || info.outputPer1M > 0) {
      out.line(ui.kv('spend', pc.dim(`${fmtCost(session.cost)} est. (approx list prices)`)));
    } else {
      out.line(ui.kv('spend', pc.dim('n/a — no price on record for this model')));
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
      else if (cmd === '/model') await switchModel();
      else if (cmd === '/usage' || cmd === '/cost') showUsage();
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
      const u = await runTurn(built, message, threadId, out, active);
      // Fold the turn into the session totals, pricing it with the model that
      // was active for this turn, then show the compact status line.
      const info = chatModelInfo(built.model.modelId, built.model.providerId as AgentProviderId);
      const turnCost = estimateCost(info, u.inputTokens, u.outputTokens);
      session.turns += 1;
      session.inputTokens += u.inputTokens;
      session.outputTokens += u.outputTokens;
      session.cost += turnCost;
      session.lastContextTokens = u.inputTokens;
      if (u.inputTokens || u.outputTokens) out.line(usageLine(info, u, turnCost, session));
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
