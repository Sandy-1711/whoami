// EmailService — draft a JD-tailored job-application email from the verified
// fact base, then send it (on the CLI's approval) through the Mailer port.
//
//   draft()  — score the JD, ask the model for subject + body, append a
//              deterministic contact signature, resolve the résumé attachment,
//              and write a paste-ready draft to tailored/<company>/application-email.txt.
//   send()   — hand a drafted email to the injected Mailer.
//
// It renders nothing terminal-specific and touches the network only through the
// injected LlmProvider (drafting) and Mailer (sending), so it stays testable.
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmProvider } from '../ports/llm.js';
import type { Presenter } from '../ports/logger.js';
import type { Mailer, EmailAttachment, SendResult } from '../ports/mailer.js';
import {
  extractJdKeywords, classify, scoreResume, latexToPlainText,
} from '../tailor/core.js';
import { slugCompany, sanitizeRole, extractRoleFromJd } from '../naming.js';
import { drift } from '../profile/sources.js';
import { loadProfileDigestText } from '../profile/loaders.js';
import {
  emailPrompt, EMAIL_SCHEMA, type EmailResponse,
} from '../prompts.js';
import type { Facts, Classification, Score } from '../types.js';

export interface EmailDraftRequest {
  jd: string;
  company: string;
  role?: string;
  // Attachment control: an explicit path to attach, or false to attach nothing.
  // Omitted → auto-attach the tailored résumé PDF from tailored/<slug> if present.
  attach?: string | false;
}

export interface EmailDraft {
  from: string;         // configured Gmail user (may be '' if unset — send checks)
  to: string;           // apply-to address read from the JD, or '' (CLI confirms)
  subject: string;
  body: string;         // full body incl. sign-off + appended contact signature
  rationale: string;
  role: string;
  cls: Classification;
  score: Score;
  attachments: EmailAttachment[];   // resolved, existing files only
  resumeRelPath: string | null;     // repo-relative résumé path, or null if none
  written: boolean;                 // was the draft file written to disk?
  paths: { slug: string; dir: string; relDir: string; file: string };
}

// The minimal shape send() needs. Both a cached EmailDraft and a draft loaded
// verbatim from a file satisfy it, so either can be sent without rebuilding the
// full EmailDraft (score/classification/paths are irrelevant to sending).
export type SendableDraft = Pick<EmailDraft, 'from' | 'to' | 'subject' | 'body' | 'attachments'>;

// A draft reconstructed from a saved application-email.txt on disk — the escape
// hatch for sending a hand-edited draft byte-for-byte, instead of the LLM output
// cached at draft time.
export interface FileDraft extends SendableDraft {
  resumeRelPath: string | null;   // repo-relative attachment path, or null
  path: string;                   // the source file that was read
}

export interface EmailDraftContext {
  provider: LlmProvider;
  // The sender address, so the written draft shows the real "From". Sending
  // still goes through the Mailer, which owns auth.
  from?: string;
  // Write the draft to tailored/<slug>/application-email.txt (default true). A
  // preview (CLI --dry-run) passes false so it never clobbers an existing draft.
  persist?: boolean;
}

export interface EmailSendContext {
  mailer: Mailer;
  // Final recipient after the CLI's confirmation; falls back to draft.to.
  to?: string;
}

export interface EmailServiceDeps {
  root: string;
  presenter: Presenter;
}

// Pull the first plausible apply-to address out of a JD, preferring one that
// sits near an application cue. A deterministic fallback for when the model
// returns no "to". Never used to send without the CLI's confirmation.
export function findApplyEmail(jd: string): string {
  const rx = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const all = jd.match(rx) || [];
  if (!all.length) return '';
  const cue = /(apply|application|resume|résumé|cv|send|email|hiring|careers|jobs|contact)/i;
  const near = all.find((addr) => {
    const i = jd.indexOf(addr);
    return cue.test(jd.slice(Math.max(0, i - 60), i));
  });
  return near || all[0]!;
}

export class EmailService {
  constructor(private readonly deps: EmailServiceDeps) {}

  async draft(request: EmailDraftRequest, ctx: EmailDraftContext): Promise<EmailDraft> {
    const { root, presenter } = this.deps;
    const { provider, from = '', persist = true } = ctx;
    const { jd, company, role: roleOverride = '', attach } = request;

    if (!jd || jd.trim().length < 20) throw new Error('JD text looks too short to analyze.');
    if (!company || !company.trim()) throw new Error('No company given — pass --company "Acme AI".');

    const facts = await this.facts();
    const resumeText = latexToPlainText(await readFile(join(root, 'resume.tex'), 'utf8'));
    await this.warnDrift();

    // Deterministic keyword read so the email leans on real matches, never a gap.
    const jdKeywords = extractJdKeywords(jd);
    const cls = classify(jdKeywords, resumeText, facts);
    const score = scoreResume(cls);
    const role = roleOverride || extractRoleFromJd(jd) || 'Software Engineer';
    const candidateName = facts.identity?.name || 'Sandeep Singh';

    // Resolve the résumé attachment before drafting so the prompt knows whether
    // it may say "attached".
    const slug = slugCompany(company);
    const dir = join(root, 'tailored', slug);
    const attachment = await this.resolveAttachment(dir, slug, candidateName, role, attach);

    // Ranked GitHub/LinkedIn evidence so the email cites real repos/PRs.
    const digest = await loadProfileDigestText(root);

    const spin = presenter.spinner(`Asking ${provider.label} (${provider.model}) to draft the application email…`);
    let parsed: EmailResponse;
    try {
      parsed = await provider.generateJson<EmailResponse>({
        prompt: emailPrompt({
          jd, company, role: roleOverride, facts, classification: cls,
          candidateName, hasResume: Boolean(attachment), digest,
        }),
        schema: EMAIL_SCHEMA,
      });
      if (!parsed?.subject?.trim() || !parsed?.body?.trim()) throw new Error('empty subject/body');
      spin.succeed(`${provider.label} drafted the email.`);
    } catch (err) {
      spin.fail(`${provider.label} failed: ${(err as Error).message}`);
      throw new Error(`Check the ${provider.label} API key / quota / model name and retry.`);
    }

    const subject = parsed.subject.trim();
    const body = withSignature(parsed.body.trim(), facts);
    const to = (parsed.to || '').trim() || findApplyEmail(jd);

    const file = join(dir, 'application-email.txt');
    if (persist) {
      await mkdir(dir, { recursive: true });
      await writeFile(file, draftFile({ to, from, subject, body }));
    }

    return {
      from, to, subject, body,
      rationale: (parsed.rationale || '').trim(),
      role, cls, score,
      attachments: attachment ? [attachment] : [],
      resumeRelPath: attachment ? `tailored/${slug}/${attachment.filename}` : null,
      written: persist,
      paths: { slug, dir, relDir: `tailored/${slug}`, file },
    };
  }

  // Load a saved draft artifact from disk and reconstruct a sendable draft, so a
  // hand-edited application-email.txt is sent exactly as written (the cached
  // draft can diverge from the file). Attaches nothing unless an explicit PDF
  // path is given.
  async loadFileDraft(path: string, opts: { attach?: string } = {}): Promise<FileDraft> {
    if (!(await exists(path))) throw new Error(`Draft file not found: ${path}`);
    const { to, from, subject, body } = parseDraftFile(await readFile(path, 'utf8'));
    if (!subject.trim()) throw new Error(`No "Subject:" header found in ${path}.`);
    if (!body.trim()) throw new Error(`No message body found in ${path}.`);
    let attachments: EmailAttachment[] = [];
    let resumeRelPath: string | null = null;
    const attach = opts.attach?.trim();
    if (attach) {
      if (!(await exists(attach))) throw new Error(`Attachment not found: ${attach}`);
      attachments = [{ filename: baseName(attach), path: attach, contentType: pdfType(attach) }];
      resumeRelPath = attach;
    }
    return { from, to, subject, body, attachments, resumeRelPath, path };
  }

  async send(draft: SendableDraft, ctx: EmailSendContext): Promise<SendResult> {
    const { mailer, to } = ctx;
    const recipient = (to || draft.to || '').trim();
    if (!recipient) throw new Error('No recipient address — pass --to or add one to the JD.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) throw new Error(`"${recipient}" is not a valid email address.`);
    if (!mailer.available) throw new Error('Gmail not configured — set GMAIL_USER and GMAIL_APP_PASSWORD in .env.');
    return mailer.send({
      from: draft.from || undefined,
      to: recipient,
      subject: draft.subject,
      text: draft.body,
      attachments: draft.attachments,
    });
  }

  // Decide what to attach: an explicit path, nothing (false), or auto — the
  // tailored résumé PDF for this company/role, else any PDF in the folder.
  private async resolveAttachment(
    dir: string, slug: string, candidateName: string, role: string, attach?: string | false,
  ): Promise<EmailAttachment | null> {
    if (attach === false) return null;
    if (typeof attach === 'string' && attach.trim()) {
      const path = attach.trim();
      if (!(await exists(path))) throw new Error(`Attachment not found: ${path}`);
      return { filename: baseName(path), path, contentType: pdfType(path) };
    }
    // Auto: prefer "<Name> - <Role>.pdf", else the first PDF in the folder.
    const preferred = `${candidateName} - ${sanitizeRole(role)}.pdf`;
    const preferredPath = join(dir, preferred);
    if (await exists(preferredPath)) return { filename: preferred, path: preferredPath, contentType: 'application/pdf' };
    let entries: string[] = [];
    try { entries = await readdir(dir); } catch { return null; }
    const pdf = entries.find((f) => f.toLowerCase().endsWith('.pdf'));
    return pdf ? { filename: pdf, path: join(dir, pdf), contentType: 'application/pdf' } : null;
  }

  private async facts(): Promise<Facts> {
    return JSON.parse(await readFile(join(this.deps.root, 'profile', 'facts.json'), 'utf8'));
  }

  // The copy is only as fresh as facts.json — warn if the sources drifted.
  private async warnDrift(): Promise<void> {
    const { root, presenter } = this.deps;
    const d = await drift(root);
    if (!d.lock) presenter.note('No sync baseline yet — run `sync` after profile edits.');
    else if (!d.synced) presenter.warn(`Profile sources changed since last sync: ${d.changed.join(', ')}. Fact base may be stale.`);
  }
}

// Append a compact, always-correct contact signature drawn from facts.identity,
// so links are never hallucinated. Skipped if the model already emitted one.
function withSignature(body: string, facts: Facts): string {
  const id = facts.identity || {};
  const links = [id.portfolio, id.github, id.linkedin].filter(Boolean) as string[];
  if (!links.length) return body;
  // Don't double up if the body already carries a link line.
  if (links.some((l) => body.includes(l))) return body;
  return `${body.replace(/\s+$/, '')}\n\n${links.join('  ·  ')}`;
}

// The human-readable draft artifact (matches the To:/Subject: header style used
// for earlier applications). Never committed — tailored/ is gitignored.
function draftFile({ to, from, subject, body }: { to: string; from: string; subject: string; body: string }): string {
  const L = [
    `To: ${to || '(no apply-to address found — fill in before sending)'}`,
  ];
  if (from) L.push(`From: ${from}`);
  L.push(`Subject: ${subject}`, '', body, '');
  return L.join('\n');
}

// The inverse of draftFile: read a saved draft artifact back into its parts. The
// leading contiguous To:/From:/Subject: lines are headers; the first blank line
// (or first non-header line) starts the body, which is returned verbatim minus
// trailing whitespace. Missing headers come back as empty strings.
export function parseDraftFile(content: string): { to: string; from: string; subject: string; body: string } {
  const lines = content.split(/\r?\n/);
  const headers: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') { i++; break; }            // blank line ends the header block
    const m = /^(to|from|subject):\s*(.*)$/i.exec(line);
    if (!m) break;                                     // first non-header line starts the body
    headers[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  const body = lines.slice(i).join('\n').replace(/\s+$/, '');
  return { to: headers.to || '', from: headers.from || '', subject: headers.subject || '', body };
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function baseName(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
}

function pdfType(p: string): string | undefined {
  return p.toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined;
}
