// Email tools — draft a JD-tailored application email, then send it ONLY through
// the human confirm gate. draft_application_email produces and persists the
// draft; send_application_email sends the exact drafted content (looked up from a
// per-session cache, so the sent email is byte-for-byte what was shown — never a
// re-generated variant). Sending is gated by deps.confirm, which the model
// cannot answer for the user.
import { relative, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { EmailService, slugCompany, type EmailDraft, type EmailAttachment } from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { cap } from './shared.js';
import { JD_INPUT_SHAPE, resolveJd } from './inputs.js';

const rel = (root: string, p: string): string => relative(root, p).replace(/\\/g, '/');
const preview = (body: string, n = 600): string => (body.length > n ? body.slice(0, n) + '…' : body);

// Where EmailService.draft persists every draft it writes.
const savedDraftPath = (root: string, company: string): string =>
  join(root, 'tailored', slugCompany(company), 'application-email.txt');

export function emailTools(deps: AgentDeps) {
  const service = new EmailService({ root: deps.root, presenter: deps.presenter });
  // Cache the last draft per company so send transmits exactly what was drafted.
  const drafts = new Map<string, EmailDraft>();

  const draft_application_email = createTool({
    id: 'draft_application_email',
    description:
      'Draft a JD-tailored job-application email from the fact base. Reads the apply-to address and ' +
      'subject from the JD, appends a correct contact signature, and auto-attaches the tailored ' +
      'résumé PDF from tailored/<company>/ if present. Persists the draft and returns it for review. ' +
      'Does NOT send — always show the draft first, then use send_application_email.',
    inputSchema: z.object({
      ...JD_INPUT_SHAPE,
      company: z.string().describe('Company name — files the draft.'),
      role: z.string().optional().describe('Role override; omit to infer from the JD.'),
      to: z.string().optional().describe('Recipient override; omit to read the apply-to address from the JD.'),
      attach: z.string().optional().describe('Explicit résumé PDF path to attach.'),
      noAttach: z.boolean().optional().describe('Attach nothing.'),
    }),
    execute: async ({ company, role, to, attach, noAttach, ...jdInput }) => {
      const jd = await resolveJd(deps.root, jdInput);
      const draft = await service.draft(
        { jd, company, role: role || '', attach: noAttach ? false : attach || undefined },
        { llm: deps.llm, from: deps.config.gmail?.user || '', persist: true },
      );
      drafts.set(draft.paths.slug, draft);
      return {
        to: (to || draft.to) || null,
        subject: draft.subject,
        bodyPreview: preview(draft.body),
        attachment: draft.resumeRelPath,
        grounding: cap([...draft.cls.matched, ...draft.cls.addable]),
        gmailConfigured: deps.mailer.available,
        file: rel(deps.root, draft.paths.file),
        note: deps.mailer.available
          ? 'Review, then send_application_email to send (a confirmation is required).'
          : 'Gmail not configured — drafting only. Set GMAIL_USER + GMAIL_APP_PASSWORD to send.',
      };
    },
  });

  const send_application_email = createTool({
    id: 'send_application_email',
    description:
      'Send an application email. Sends the exact content drafted for this company: the draft from ' +
      'this session if there is one, otherwise the saved tailored/<company>/application-email.txt — ' +
      'so a draft written before a restart, or edited by hand afterwards, is still sendable. Pass ' +
      '`path` to send a specific draft file instead. Requires Gmail configured, and passes through a ' +
      'confirmation of the recipient that you cannot bypass. Use only after the user has seen the ' +
      'draft and asked to send.',
    inputSchema: z.object({
      company: z.string().describe('Company whose draft to send / label under which the send is logged.'),
      to: z.string().optional().describe('Recipient override; else the drafted apply-to address.'),
      path: z.string().optional().describe('A specific saved draft .txt (To:/From:/Subject: headers + body) to send verbatim.'),
      attach: z.string().optional().describe('Explicit PDF path to attach when sending from `path` (a file draft carries no attachment on its own).'),
    }),
    execute: async ({ company, to, path, attach }) => {
      if (!deps.mailer.available) {
        return { sent: false, reason: 'Gmail not configured — set GMAIL_USER and GMAIL_APP_PASSWORD in .env.' };
      }

      // Source the email either from a file — sent byte-for-byte, which is what
      // makes a hand-edited draft survive — or from this session's cache.
      let src: { from: string; to: string; subject: string; body: string; attachments: EmailAttachment[]; resumeRelPath: string | null; role: string };
      const file = path || savedDraftPath(deps.root, company);
      const cached = path ? undefined : drafts.get(slugCompany(company));
      if (cached) {
        src = { from: cached.from, to: cached.to, subject: cached.subject, body: cached.body, attachments: cached.attachments, resumeRelPath: cached.resumeRelPath, role: cached.role };
      } else if (path || existsSync(file)) {
        // The draft this company already has on disk. Without this, restarting
        // the MCP server made a draft written minutes ago unsendable.
        const fd = await service.loadFileDraft(file, { attach });
        src = { from: fd.from, to: fd.to, subject: fd.subject, body: fd.body, attachments: fd.attachments, resumeRelPath: fd.resumeRelPath, role: '' };
      } else {
        throw new Error(`No draft for "${company}" — none in this session and no ${rel(deps.root, file)} on disk. Call draft_application_email first, or write that file yourself.`);
      }

      const recipient = (to || src.to || '').trim();
      if (!recipient) return { sent: false, reason: 'No recipient address — pass `to`, or ensure the draft has an apply-to address.' };

      const attachNote = src.attachments.length ? ` with ${src.attachments[0]!.filename}` : ' (no résumé attached)';
      const ok = await deps.confirm(`Send the application email to ${recipient}${attachNote} from ${src.from || deps.config.gmail?.user}?`);
      if (!ok) return { sent: false, reason: 'Cancelled — not sent.' };

      const res = await service.send(
        { from: src.from, to: src.to, subject: src.subject, body: src.body, attachments: src.attachments },
        { mailer: deps.mailer, to: recipient },
      );
      return {
        sent: true, company, role: src.role, to: recipient,
        messageId: res.messageId, accepted: res.accepted, rejected: res.rejected,
        artifacts: src.resumeRelPath ? [src.resumeRelPath] : [],
      };
    },
  });

  return { draft_application_email, send_application_email };
}
