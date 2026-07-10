// `resume email` — draft a JD-tailored application email from the fact base,
// show it, and send it via Gmail ONLY after the user approves the recipient.
// The pipeline (drafting + sending) lives in @resume/core; this command wires
// config → provider → service, draws the draft, and owns the approval prompts.
import { relative } from 'node:path';
import * as p from '@clack/prompts';
import { EmailService, type EmailDraft } from '@resume/core';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

export interface RunEmailArgs {
  jd: string;
  company: string;
  role?: string;
  to?: string;            // recipient override; else read from the JD
  attach?: string;        // explicit attachment path; else auto
  noAttach?: boolean;     // attach nothing
  dryRun?: boolean;       // draft + show only, never send
  autoSend?: boolean;     // skip the confirmation prompts (--yes)
  provider?: string;
  model?: string;
}

export async function runEmail(cli: Cli, args: RunEmailArgs): Promise<void> {
  const { jd, company, role = '', to, attach, noAttach, dryRun, autoSend, provider, model } = args;
  const llm = cli.registry.resolve(cli.config, { provider, model });
  console.log(ui.banner('Application Email', `JD → email · engine: ${llm.label} ${llm.model}`));

  const service = new EmailService({ root: cli.root, presenter: cli.presenter });
  const draft = await service.draft(
    { jd, company, role, attach: noAttach ? false : attach || undefined },
    // A --dry-run is a read-only preview: never overwrite an existing draft file.
    { provider: llm, from: cli.config.gmail.user, persist: !dryRun },
  );
  renderDraft(cli, draft);

  // Draft-only exits: an explicit --dry-run, or no Gmail credentials to send with.
  if (dryRun) {
    console.log('\n' + ui.info('Dry run — drafted, not sent.') + '\n');
    return;
  }
  if (!cli.mailer.available) {
    console.log(
      '\n' + ui.warn('Gmail not configured — drafted only, nothing sent.') +
      '\n  ' + pc.dim('Set GMAIL_USER and GMAIL_APP_PASSWORD in .env, then re-run to send. See .env.example.') + '\n',
    );
    return;
  }

  // ---- approval -------------------------------------------------------------
  const recipient = await confirmRecipient(draft, { to, autoSend });
  if (recipient === null) { console.log('\n' + ui.info('Cancelled — not sent.') + '\n'); return; }

  if (!autoSend) {
    const attachNote = draft.attachments.length ? ` with ${pc.cyan(draft.attachments[0]!.filename)}` : ' (no résumé attached)';
    const go = await p.confirm({
      message: `Send this email to ${pc.cyan(recipient)}${attachNote} from ${pc.dim(draft.from || cli.config.gmail.user)}?`,
      initialValue: false,
    });
    if (p.isCancel(go) || !go) { console.log('\n' + ui.info('Cancelled — not sent.') + '\n'); return; }
  }

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

// Approve the recipient. With --yes, use --to or the JD address as-is (no
// prompt). Otherwise prompt, pre-filled with the JD address. Returns the final
// address, or null on cancel / no address under --yes.
async function confirmRecipient(
  draft: EmailDraft, { to, autoSend }: { to?: string; autoSend?: boolean },
): Promise<string | null> {
  const suggested = (to || draft.to || '').trim();
  if (autoSend) return suggested || null;
  const answer = await p.text({
    message: 'Send to (Enter to accept, edit to change):',
    initialValue: suggested,
    placeholder: 'hiring@company.com',
    validate: (v) => (v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? undefined : 'Enter a valid email address.'),
  });
  if (p.isCancel(answer)) return null;
  return answer.trim();
}

function renderDraft(cli: Cli, d: EmailDraft): void {
  const rel = relative(cli.root, d.paths.file).replace(/\\/g, '/');
  const L: string[] = [];

  L.push(ui.heading('To'));
  L.push('  ' + (d.to ? pc.cyan(d.to) : pc.yellow('(no apply-to address in the JD — you\'ll be asked before sending)')));
  L.push(ui.heading('Subject'));
  L.push('  ' + pc.bold(d.subject));
  L.push(ui.heading('Body'));
  L.push('');
  L.push(boxed(d.body));

  L.push(ui.heading('Attachment'));
  L.push('  ' + (d.resumeRelPath
    ? pc.green('✔ ') + pc.cyan(d.resumeRelPath)
    : pc.yellow('none — run `resume tailor` first, or pass --attach <path>')));

  if (d.rationale) { L.push(ui.heading('Why this framing')); L.push('  ' + pc.dim(d.rationale)); }

  L.push(ui.heading(`Grounding — JD keywords you can truthfully lean on (${d.cls.matched.length + d.cls.addable.length})`));
  L.push(ui.chips([...d.cls.matched, ...d.cls.addable], 'good'));
  if (d.cls.missing.length) {
    L.push(ui.heading(`Not claimed — JD wants, not in your fact base (${d.cls.missing.length})`));
    L.push(ui.chips(d.cls.missing, 'bad'));
  }
  L.push(ui.heading('Résumé ATS coverage for this JD'));
  L.push('  ' + ui.gauge('coverage', d.score.after));

  L.push(ui.heading('Output'));
  L.push(ui.kv('company', pc.cyan(d.paths.slug)));
  L.push(ui.kv('draft', d.written ? pc.cyan(rel) : pc.dim(`${rel} ${pc.yellow('(preview — not written)')}`)));
  console.log(L.join('\n'));
}

// A cyan-bordered box around the email body so it stands apart from the chrome.
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
