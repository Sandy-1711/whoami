#!/usr/bin/env node
// resume — one entrypoint for the whole résumé toolkit.
//
// Drafting lives with the agent (`resume chat`, or the MCP tools) — the commands
// here are the ones worth having without one: the toolchain, the free
// deterministic reads, and putting an already-written email on the wire.
//
//   resume                         interactive menu
//   resume chat / mcp              the agent, in a terminal or over MCP
//   resume send --company X        mail tailored/<company>/application-email.txt
//   resume sync [--force]          refresh the scraped GitHub source
//   resume score / digest / status free, deterministic
//   resume build                   render profile/resume.json → resume.tex → apps/web/assets/resume.pdf
//   resume check [--source|--pdf|--width]
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as p from '@clack/prompts';
import * as ui from './ui.js';
import { pc } from './ui.js';
import { startTracing } from '@resume/llm';
import { parseArgs } from './args.js';
import { buildCli, type Cli } from './container.js';

const { cmd, has, opt, positionals } = parseArgs(process.argv.slice(2));

function fail(err: unknown): never {
  console.error('\n' + ui.fail((err as Error)?.message || String(err)) + '\n');
  process.exit(1);
}

async function fileJd(file?: string): Promise<string> {
  if (!file) return '';
  if (!existsSync(file)) throw new Error(`JD file not found: ${file}`);
  return readFile(file, 'utf8');
}

function commands(cli: Cli): Record<string, () => Promise<unknown>> {
  return {
    chat: async () => (await import('./commands/chat.js')).runChat(cli, { fresh: has('--new') }),
    mcp: async () => (await import('./commands/mcp.js')).runMcp(cli),
    send: async () => (await import('./commands/send.js')).runSend(cli, {
      company: opt('--company') || opt('--name'),
      path: opt('--path') || undefined,
      to: opt('--to') || undefined,
      attach: opt('--attach') || undefined,
      noAttach: has('--no-attach'),
      dryRun: has('--dry-run') || has('--no-send'),
    }),
    sync: async () => (await import('./commands/sync.js')).runSync(cli, { force: has('--force'), linkedin: has('--linkedin') }),
    score: async () => {
      const { runScore } = await import('./commands/score.js');
      const jd = opt('--jd') || (await fileJd(positionals()[0]));
      return runScore(cli, { jd });
    },
    digest: async () => (await import('./commands/digest.js')).runDigest(cli, { json: has('--json') }),
    status: async () => (await import('./commands/status.js')).runStatus(cli),
    build: async () => (await import('./commands/build.js')).runBuild(cli),
    check: async () => {
      const scope = has('--pdf') ? 'pdf' : has('--width') ? 'width' : has('--source') ? 'source' : 'all';
      return (await import('./commands/check.js')).runCheck(cli, { scope });
    },
    help: async () => printHelp(),
  };
}

function printHelp(): void {
  console.log(ui.banner('resume', 'JD-tailored résumés from a verified profile'));
  console.log(`
  ${pc.bold('Commands')}
    ${pc.cyan('chat')} [--new]                                              chat with the job-search agent (all tools)
    ${pc.cyan('mcp')}                                                       serve the tools over MCP (stdio) for Claude Code / Cursor
    ${pc.cyan('send')} --company <name> [--path <draft>] [--to <addr>] [--attach <pdf>|--no-attach] [--dry-run]   mail a saved draft verbatim
    ${pc.cyan('sync')} [--force]                                            refresh the scraped GitHub source
    ${pc.cyan('score')} <jd-file> | --jd "text…"                             deterministic JD fit score — free, no LLM
    ${pc.cyan('digest')} [--json]                                            ranked GitHub/LinkedIn evidence digest — free, no LLM
    ${pc.cyan('status')}                                                    env, sources, outputs
    ${pc.cyan('build')}                                                     compile the canonical PDF
    ${pc.cyan('check')} [--source|--pdf|--width]                            run the guards

  ${pc.dim('Tailoring, drafting and research are the agent\'s: `resume chat`, or the MCP tools.')}
  ${pc.dim('Run with no command for an interactive menu.')}
`);
}

// ---- interactive menu ------------------------------------------------------
async function interactive(cli: Cli): Promise<void> {
  console.clear();
  p.intro(ui.gradientText(' résumé studio '));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const action = await p.select({
      message: 'What do you want to do?',
      options: [
        { value: 'chat', label: 'Chat with the agent', hint: 'tailor, draft, research — every capability as a tool' },
        { value: 'send', label: 'Send a saved application email', hint: 'tailored/<company>/application-email.txt → Gmail' },
        { value: 'sync', label: 'Sync profile sources', hint: 'refresh the GitHub scrape' },
        { value: 'status', label: 'Status', hint: 'env, sources, outputs' },
        { value: 'build', label: 'Build canonical résumé', hint: 'resume.json → resume.tex → PDF' },
        { value: 'check', label: 'Run guards', hint: 'structure / pages / width' },
        { value: 'exit', label: 'Exit' },
      ],
    });
    if (p.isCancel(action) || action === 'exit') { p.outro('Bye 👋'); return; }

    try {
      if (action === 'chat') { await (await import('./commands/chat.js')).runChat(cli); continue; }
      else if (action === 'send') await interactiveSend(cli);
      else if (action === 'sync') {
        const force = await p.confirm({ message: 'Force re-scrape (ignore the freshness TTL)?', initialValue: false });
        if (p.isCancel(force)) continue;
        await (await import('./commands/sync.js')).runSync(cli, { force });
      } else if (action === 'status') await (await import('./commands/status.js')).runStatus(cli);
      else if (action === 'build') await (await import('./commands/build.js')).runBuild(cli);
      else if (action === 'check') await (await import('./commands/check.js')).runCheck(cli, {});
    } catch (err) {
      console.log('\n' + ui.fail((err as Error).message) + '\n');
    }
    const again = await p.confirm({ message: 'Back to menu?', initialValue: true });
    if (p.isCancel(again) || !again) { p.outro('Bye 👋'); return; }
    console.clear();
  }
}

async function interactiveSend(cli: Cli): Promise<void> {
  const company = await p.text({
    message: 'Company name',
    placeholder: 'Acme-AI',
    validate: (v) => (v && v.trim() ? undefined : 'Required — the draft is filed by company.'),
  });
  if (p.isCancel(company)) return;

  const { runSend } = await import('./commands/send.js');
  await runSend(cli, { company: company.trim() });
}

// ---- dispatch --------------------------------------------------------------
async function main(): Promise<unknown> {
  // MCP mode speaks JSON-RPC on stdout — silence console.* to stderr BEFORE we
  // build anything, so no adapter/library banner can corrupt the protocol stream.
  // (The stdio transport writes via process.stdout.write directly, untouched.)
  if (cmd === 'mcp') { const e = console.error.bind(console); console.log = e; console.info = e; console.debug = e; }
  const cli = buildCli();
  // Spans buffer, so the flush has to outlive the command that produced them.
  const tracing = await startTracing(cli.config.langfuse);
  try {
    if (!cmd) return await interactive(cli);
    const run = commands(cli)[cmd];
    if (!run) { printHelp(); throw new Error(`Unknown command: ${cmd}`); }
    return await run();
  } finally {
    await tracing?.shutdown();
  }
}

main().catch(fail);
