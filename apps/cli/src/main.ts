#!/usr/bin/env node
// resume — one entrypoint for the whole résumé toolkit.
//
//   resume                         interactive menu
//   resume tailor <jd> --company X [--role X] [--provider gemini|deepseek] [--model X]
//   resume tailor --jd "text..." --company X
//   resume sync [--force]          refresh scraped GitHub + LinkedIn sources
//   resume status                  show env, sources, outputs
//   resume build                   compile resume.tex → apps/web/assets/resume.pdf
//   resume check [--source|--pdf|--width]
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import * as p from '@clack/prompts';
import * as ui from './ui.js';
import { pc } from './ui.js';
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

// ---- direct commands -------------------------------------------------------
async function directTailor(cli: Cli): Promise<void> {
  const { runTailor } = await import('./commands/tailor.js');
  const jd = opt('--jd') || (await fileJd(positionals()[0]));
  await runTailor(cli, {
    jd,
    company: opt('--company') || opt('--name'),
    role: opt('--role'),
    provider: opt('--provider'),
    model: opt('--model'),
  });
}

async function directWellfound(cli: Cli): Promise<void> {
  const { runWellfound } = await import('./commands/wellfound.js');
  const jd = opt('--jd') || (await fileJd(positionals()[0]));
  await runWellfound(cli, {
    jd,
    company: opt('--company') || opt('--name'),
    role: opt('--role'),
    messageOnly: has('--message-only'),
    provider: opt('--provider'),
    model: opt('--model'),
  });
}

function commands(cli: Cli): Record<string, () => Promise<unknown>> {
  return {
    tailor: () => directTailor(cli),
    wellfound: () => directWellfound(cli),
    sync: async () => (await import('./commands/sync.js')).runSync(cli, { force: has('--force') }),
    status: async () => (await import('./commands/status.js')).runStatus(cli),
    build: async () => (await import('./commands/build.js')).runBuild(cli),
    check: async () => {
      const scope = has('--pdf') ? '--pdf' : has('--width') ? '--log' : has('--source') ? '--source' : '';
      return (await import('./commands/check.js')).runCheck(cli, { scope });
    },
    help: async () => printHelp(),
  };
}

function printHelp(): void {
  console.log(ui.banner('resume', 'JD-tailored résumés from a verified profile'));
  console.log(`
  ${pc.bold('Commands')}
    ${pc.cyan('tailor')} <jd> --company <name> [--role <r>] [--provider gemini|deepseek] [--model <m>]   tailor to a JD
    ${pc.cyan('wellfound')} <jd> --company <name> [--role <r>] [--message-only]      Wellfound note + profile refresh
    ${pc.cyan('sync')} [--force]                                            refresh GitHub + LinkedIn
    ${pc.cyan('status')}                                                    env, sources, outputs
    ${pc.cyan('build')}                                                     compile the canonical PDF
    ${pc.cyan('check')} [--source|--pdf|--width]                            run the guards

  ${pc.dim('Provider defaults to $LLM_PROVIDER, else whichever API key is set (Gemini first).')}
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
        { value: 'tailor', label: 'Tailor to a job description', hint: 'score → rewrite → PDF' },
        { value: 'wellfound', label: 'Wellfound assistant', hint: 'JD → application note + profile refresh' },
        { value: 'sync', label: 'Sync profile sources', hint: 'scrape GitHub + LinkedIn' },
        { value: 'status', label: 'Status', hint: 'env, sources, outputs' },
        { value: 'build', label: 'Build canonical résumé', hint: 'resume.tex → PDF' },
        { value: 'check', label: 'Run guards', hint: 'structure / pages / width' },
        { value: 'exit', label: 'Exit' },
      ],
    });
    if (p.isCancel(action) || action === 'exit') { p.outro('Bye 👋'); return; }

    try {
      if (action === 'tailor') await interactiveTailor(cli);
      else if (action === 'wellfound') await interactiveWellfound(cli);
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

async function interactiveTailor(cli: Cli): Promise<void> {
  const company = await p.text({
    message: 'Company name',
    placeholder: 'Inteligen-ai',
    validate: (v) => (v && v.trim() ? undefined : 'Required — the résumé is filed + named by company.'),
  });
  if (p.isCancel(company)) return;

  const source = await p.select({
    message: 'How do you want to provide the JD?',
    options: [
      { value: 'file', label: 'Path to a JD file', hint: './jd.txt' },
      { value: 'paste', label: 'Paste the JD text', hint: 'multi-line paste' },
    ],
  });
  if (p.isCancel(source)) return;

  let jd: string;
  if (source === 'file') {
    const file = await p.text({
      message: 'Path to the JD file',
      placeholder: './jd.txt',
      validate: (v) => (v && existsSync(v.trim()) ? undefined : 'File not found — save the JD to a file and give its path.'),
    });
    if (p.isCancel(file)) return;
    jd = await readFile(file.trim(), 'utf8');
  } else {
    jd = await pasteJd();
    if (!jd.trim()) { console.log('\n' + ui.fail('No JD text received.') + '\n'); return; }
  }

  const role = await p.text({ message: 'Role override (optional — blank = read from JD)', placeholder: '' });
  if (p.isCancel(role)) return;

  // Ask which model only when more than one provider has a key configured.
  let provider = '';
  const withKeys = cli.registry.list().filter((f) => cli.config.llm.keys[f.id]);
  if (withKeys.length > 1) {
    const pick = await p.select({
      message: 'Which model should tailor the résumé?',
      initialValue: cli.registry.defaultProviderId(cli.config),
      options: withKeys.map((f) => ({ value: f.id, label: f.label, hint: cli.config.llm.models[f.id] || f.defaultModel })),
    });
    if (p.isCancel(pick)) return;
    provider = pick as string;
  }

  const { runTailor } = await import('./commands/tailor.js');
  await runTailor(cli, { jd, company: company.trim(), role: (role || '').trim(), provider });
}

async function interactiveWellfound(cli: Cli): Promise<void> {
  const company = await p.text({
    message: 'Company name',
    placeholder: 'Inteligen-ai',
    validate: (v) => (v && v.trim() ? undefined : 'Required — the note + profile draft are filed by company.'),
  });
  if (p.isCancel(company)) return;

  const source = await p.select({
    message: 'How do you want to provide the JD?',
    options: [
      { value: 'file', label: 'Path to a JD file', hint: './jd.txt' },
      { value: 'paste', label: 'Paste the JD text', hint: 'multi-line paste' },
    ],
  });
  if (p.isCancel(source)) return;

  let jd: string;
  if (source === 'file') {
    const file = await p.text({
      message: 'Path to the JD file',
      placeholder: './jd.txt',
      validate: (v) => (v && existsSync(v.trim()) ? undefined : 'File not found — save the JD to a file and give its path.'),
    });
    if (p.isCancel(file)) return;
    jd = await readFile(file.trim(), 'utf8');
  } else {
    jd = await pasteJd();
    if (!jd.trim()) { console.log('\n' + ui.fail('No JD text received.') + '\n'); return; }
  }

  const role = await p.text({ message: 'Role override (optional — blank = read from JD)', placeholder: '' });
  if (p.isCancel(role)) return;

  const scope = await p.confirm({ message: 'Also generate a Wellfound profile refresh (headline / about / skills)?', initialValue: true });
  if (p.isCancel(scope)) return;

  // Ask which model only when more than one provider has a key configured.
  let provider = '';
  const withKeys = cli.registry.list().filter((f) => cli.config.llm.keys[f.id]);
  if (withKeys.length > 1) {
    const pick = await p.select({
      message: 'Which model should draft the note?',
      initialValue: cli.registry.defaultProviderId(cli.config),
      options: withKeys.map((f) => ({ value: f.id, label: f.label, hint: cli.config.llm.models[f.id] || f.defaultModel })),
    });
    if (p.isCancel(pick)) return;
    provider = pick as string;
  }

  const { runWellfound } = await import('./commands/wellfound.js');
  await runWellfound(cli, { jd, company: company.trim(), role: (role || '').trim(), messageOnly: !scope, provider });
}

// Clack has no built-in multiline text prompt, so pasted JDs are read directly
// off stdin. A blank-line terminator won't do — JDs routinely contain blank
// lines between sections — so we end on a lone `.` sentinel. Clack leaves stdin
// in raw mode, where Ctrl+D/Ctrl+Z is never turned into EOF, so we drop raw mode
// for the read and restore it afterwards for the prompts that follow.
async function pasteJd(): Promise<string> {
  console.log(
    '\n' + ui.info(`Paste the JD below. When done, type ${pc.bold('.')} on a line by itself and press Enter.`) + '\n',
  );
  const stdin = process.stdin;
  const wasRaw = Boolean(stdin.isTTY && stdin.isRaw);
  if (stdin.isTTY) stdin.setRawMode(false);
  const rl = createInterface({ input: stdin });
  const lines: string[] = [];
  try {
    for await (const line of rl) {
      if (line.trim() === '.') break;
      lines.push(line);
    }
  } finally {
    rl.close();
    if (stdin.isTTY) stdin.setRawMode(wasRaw);
  }
  return lines.join('\n').trim();
}

// ---- dispatch --------------------------------------------------------------
async function main(): Promise<unknown> {
  const cli = buildCli();
  if (!cmd) return interactive(cli);
  const run = commands(cli)[cmd];
  if (!run) { printHelp(); throw new Error(`Unknown command: ${cmd}`); }
  return run();
}

main().catch(fail);
