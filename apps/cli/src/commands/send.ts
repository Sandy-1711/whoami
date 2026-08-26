// `resume send` — mail an application email that already exists on disk, exactly
// as written. No model runs here: the draft came from the agent, from a Claude
// Code session, or from your own editor, and this command's only job is to show
// it and put it on the wire once you approve the recipient.
import { join, relative, resolve } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import * as p from '@clack/prompts';
import { EmailService, slugCompany, type FileDraft } from '@resume/core';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

export interface RunSendArgs {
  company: string;
  path?: string;        // a specific draft file; else tailored/<company>/application-email.txt
  to?: string;          // recipient override; else the draft's To: header
  attach?: string;      // explicit attachment; else the newest PDF beside the draft
  noAttach?: boolean;
  dryRun?: boolean;     // show it and stop
}

export async function runSend(cli: Cli, args: RunSendArgs): Promise<void> {
  const { company, path, to, attach, noAttach, dryRun } = args;
  if (!company.trim() && !path) throw new Error('Which draft? Pass --company, or --path to a draft file.');

  const slug = slugCompany(company);
  const dir = join(cli.root, 'tailored', slug);
  const file = path ? resolve(cli.root, path) : join(dir, 'application-email.txt');

  console.log(ui.banner('Send Application Email', 'sends the saved draft verbatim · no model call'));

  const service = new EmailService({ root: cli.root, presenter: cli.presenter });
  const chosen = noAttach ? undefined : attach || (await newestPdf(dir));
  const draft = await service.loadFileDraft(file, { attach: chosen });
  render(cli, draft, file);

  if (dryRun) { console.log('\n' + ui.info('Dry run — shown, not sent.') + '\n'); return; }
  if (!cli.mailer.available) {
    console.log('\n' + ui.warn('Gmail not configured — nothing sent.')
      + '\n  ' + pc.dim('Set GMAIL_USER and GMAIL_APP_PASSWORD in .env, then re-run. See .env.example.') + '\n');
    return;
  }

  const recipient = await confirmRecipient(draft, to);
  if (recipient === null) { console.log('\n' + ui.info('Cancelled — not sent.') + '\n'); return; }

  const attachNote = draft.attachments.length ? ` with ${pc.cyan(draft.attachments[0]!.filename)}` : ' (no résumé attached)';
  const go = await p.confirm({
    message: `Send to ${pc.cyan(recipient)}${attachNote} from ${pc.dim(draft.from || cli.config.gmail.user)}?`,
    initialValue: false,
  });
  if (p.isCancel(go) || !go) { console.log('\n' + ui.info('Cancelled — not sent.') + '\n'); return; }

  const spin = ui.spinner(`Sending via Gmail to ${recipient}…`);
  try {
    const res = await service.send(draft, { mailer: cli.mailer, to: recipient });
    spin.succeed(`Sent to ${res.accepted.join(', ') || recipient}.`);
    if (res.rejected.length) console.log('  ' + ui.warn(`Rejected: ${res.rejected.join(', ')}`));
    console.log('  ' + ui.kv('message-id', pc.dim(res.messageId)) + '\n');
  } catch (err) {
    spin.fail((err as Error).message);
    throw err;
  }
}

// The résumé that belongs with this draft: the most recently built PDF sitting
// beside it. Explicit --attach wins; --no-attach skips this entirely.
async function newestPdf(dir: string): Promise<string | undefined> {
  let names: string[];
  try { names = await readdir(dir); } catch { return undefined; }
  const pdfs = names.filter((n) => n.toLowerCase().endsWith('.pdf'));
  if (!pdfs.length) return undefined;
  const timed = await Promise.all(pdfs.map(async (n) => ({ n, at: (await stat(join(dir, n))).mtimeMs })));
  return join(dir, timed.sort((a, b) => b.at - a.at)[0]!.n);
}

// Approve the recipient, pre-filled with the draft's own To: header.
async function confirmRecipient(draft: FileDraft, to?: string): Promise<string | null> {
  const answer = await p.text({
    message: 'Send to (Enter to accept, edit to change):',
    initialValue: (to || draft.to || '').trim(),
    placeholder: 'hiring@company.com',
    validate: (v) => (v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? undefined : 'Enter a valid email address.'),
  });
  if (p.isCancel(answer)) return null;
  return answer.trim();
}

function render(cli: Cli, d: FileDraft, file: string): void {
  const rel = (path: string): string => relative(cli.root, path).replace(/\\/g, '/');
  const L: string[] = [];
  L.push(ui.heading('Draft'));
  L.push(ui.kv('file', pc.cyan(rel(file))));
  L.push(ui.heading('To'));
  L.push('  ' + (d.to ? pc.cyan(d.to) : pc.yellow('(no To: header — you\'ll be asked before sending)')));
  L.push(ui.heading('Subject'));
  L.push('  ' + pc.bold(d.subject));
  L.push(ui.heading('Body'));
  L.push('');
  L.push(boxed(d.body));
  L.push(ui.heading('Attachment'));
  L.push('  ' + (d.attachments.length
    ? pc.green('✔ ') + pc.cyan(rel(d.attachments[0]!.path))
    : pc.yellow('none — pass --attach <pdf>, or tailor a résumé for this company first')));
  console.log(L.join('\n'));
}

// A cyan-bordered box around the body so it stands apart from the chrome.
function boxed(text: string): string {
  const width = 76;
  const wrapped = text.split('\n').flatMap((para) => wrap(para, width));
  const border = pc.cyan;
  const top = border('  ┌' + '─'.repeat(width + 2) + '┐');
  const bottom = border('  └' + '─'.repeat(width + 2) + '┘');
  const body = wrapped.map((l) => border('  │ ') + l.padEnd(width) + border(' │'));
  return [top, ...body, bottom].join('\n');
}

// Greedy word-wrap to a column width; preserves blank lines between paragraphs.
function wrap(text: string, width: number): string[] {
  if (!text.trim()) return [''];
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line.length + 1 + word.length) > width) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}
