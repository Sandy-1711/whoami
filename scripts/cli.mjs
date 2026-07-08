#!/usr/bin/env node
// resume — one entrypoint for the whole résumé toolkit.
//
//   resume                         interactive menu
//   resume tailor <jd> --company X [--role X] [--model X]
//   resume tailor --jd "text..." --company X
//   resume sync [--force]          refresh scraped GitHub + LinkedIn sources
//   resume status                  show env, sources, outputs
//   resume build                   compile resume.tex → assets/resume.pdf
//   resume check [--source|--pdf|--width]
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as p from '@clack/prompts';
import { env } from './lib/env.js';
import * as ui from './lib/ui.js';
import { chalk } from './lib/ui.js';

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
const has = (n) => argv.includes(n);
const opt = (n, d = '') => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const VALUE_FLAGS = ['--jd', '--company', '--role', '--model', '--name'];
function positionals() {
  return argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !VALUE_FLAGS.includes(arr[i - 1]));
}

function fail(err) {
  console.error('\n' + ui.fail(err?.message || String(err)) + '\n');
  process.exit(1);
}

// ---- direct commands -------------------------------------------------------
async function directTailor() {
  const { runTailor } = await import('./commands/tailor.mjs');
  const jd = opt('--jd') || (await fileJd(positionals()[0]));
  await runTailor({
    jd,
    company: opt('--company') || opt('--name'),
    role: opt('--role'),
    model: opt('--model', env.geminiModel),
  });
}

async function fileJd(file) {
  if (!file) return '';
  if (!existsSync(file)) throw new Error(`JD file not found: ${file}`);
  return readFile(file, 'utf8');
}

const COMMANDS = {
  tailor: directTailor,
  sync: async () => (await import('./commands/sync.mjs')).runSync({ force: has('--force') }),
  status: async () => (await import('./commands/status.mjs')).runStatus(),
  build: async () => (await import('./commands/build.mjs')).runBuild(),
  check: async () => {
    const scope = has('--pdf') ? '--pdf' : has('--width') ? '--log' : has('--source') ? '--source' : '';
    return (await import('./commands/check.mjs')).runCheck({ scope });
  },
  help: async () => printHelp(),
};

function printHelp() {
  console.log(ui.banner('resume', 'JD-tailored résumés from a verified profile'));
  console.log(`
  ${chalk.bold('Commands')}
    ${chalk.cyan('tailor')} <jd> --company <name> [--role <r>] [--model <m>]   tailor to a JD
    ${chalk.cyan('sync')} [--force]                                            refresh GitHub + LinkedIn
    ${chalk.cyan('status')}                                                    env, sources, outputs
    ${chalk.cyan('build')}                                                     compile the canonical PDF
    ${chalk.cyan('check')} [--source|--pdf|--width]                            run the guards

  ${chalk.dim('Run with no command for an interactive menu.')}
`);
}

// ---- interactive menu ------------------------------------------------------
async function interactive() {
  console.clear();
  p.intro(ui.gradientText(' résumé studio '));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const action = await p.select({
      message: 'What do you want to do?',
      options: [
        { value: 'tailor', label: 'Tailor to a job description', hint: 'score → rewrite → PDF' },
        { value: 'sync', label: 'Sync profile sources', hint: 'scrape GitHub + LinkedIn' },
        { value: 'status', label: 'Status', hint: 'env, sources, outputs' },
        { value: 'build', label: 'Build canonical résumé', hint: 'resume.tex → PDF' },
        { value: 'check', label: 'Run guards', hint: 'structure / pages / width' },
        { value: 'exit', label: 'Exit' },
      ],
    });
    if (p.isCancel(action) || action === 'exit') { p.outro('Bye 👋'); return; }

    try {
      if (action === 'tailor') await interactiveTailor();
      else if (action === 'sync') {
        const force = await p.confirm({ message: 'Force re-scrape (ignore the freshness TTL)?', initialValue: false });
        if (p.isCancel(force)) continue;
        await (await import('./commands/sync.mjs')).runSync({ force });
      } else if (action === 'status') await (await import('./commands/status.mjs')).runStatus();
      else if (action === 'build') await (await import('./commands/build.mjs')).runBuild();
      else if (action === 'check') await (await import('./commands/check.mjs')).runCheck({});
    } catch (err) {
      console.log('\n' + ui.fail(err.message) + '\n');
    }
    const again = await p.confirm({ message: 'Back to menu?', initialValue: true });
    if (p.isCancel(again) || !again) { p.outro('Bye 👋'); return; }
    console.clear();
  }
}

async function interactiveTailor() {
  const company = await p.text({
    message: 'Company name',
    placeholder: 'Inteligen-ai',
    validate: (v) => (v && v.trim() ? undefined : 'Required — the résumé is filed + named by company.'),
  });
  if (p.isCancel(company)) return;

  const file = await p.text({
    message: 'Path to the JD file',
    placeholder: './jd.txt',
    validate: (v) => (v && existsSync(v.trim()) ? undefined : 'File not found — save the JD to a file and give its path.'),
  });
  if (p.isCancel(file)) return;

  const role = await p.text({ message: 'Role override (optional — blank = read from JD)', placeholder: '' });
  if (p.isCancel(role)) return;

  const { runTailor } = await import('./commands/tailor.mjs');
  await runTailor({ jd: await readFile(file.trim(), 'utf8'), company: company.trim(), role: (role || '').trim() });
}

// ---- dispatch --------------------------------------------------------------
async function main() {
  if (!cmd) return interactive();
  const run = COMMANDS[cmd];
  if (!run) { printHelp(); throw new Error(`Unknown command: ${cmd}`); }
  return run();
}

main().catch(fail);
