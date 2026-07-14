// Email tools — draft a JD-tailored application email, then send it ONLY through
// the human confirm gate. draft_application_email produces and persists the
// draft; send_application_email sends the exact drafted content (looked up from a
// per-session cache, so the sent email is byte-for-byte what was shown — never a
// re-generated variant). Sending is gated by deps.confirm, which the model
// cannot answer for the user.
import { relative } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { EmailService, slugCompany, type EmailDraft } from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { cap } from './shared.js';

const rel = (root: string, p: string): string => relative(root, p).replace(/\\/g, '/');
const preview = (body: string, n = 600): string => (body.length > n ? body.slice(0, n) + '…' : body);

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
      jd: z.string().describe('The full job description text.'),
      company: z.string().describe('Company name — files the draft.'),
      role: z.string().optional().describe('Role override; omit to infer from the JD.'),
      to: z.string().optional().describe('Recipient override; omit to read the apply-to address from the JD.'),
      attach: z.string().optional().describe('Explicit résumé PDF path to attach.'),
      noAttach: z.boolean().optional().describe('Attach nothing.'),
    }),
    execute: async ({ jd, company, role, to, attach, noAttach }) => {
      const llm = deps.registry.resolve(deps.config);
      const draft = await service.draft(
        { jd, company, role: role || '', attach: noAttach ? false : attach || undefined },
        { provider: llm, from: deps.config.gmail?.user || '', persist: true },
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
      'Send the application email PREVIOUSLY drafted for this company (via draft_application_email). ' +
      'Sends the exact drafted content. Requires Gmail configured and passes through a terminal ' +
      'confirmation of the recipient — you cannot bypass it. Use only after the user has seen the ' +
      'draft and asked to send.',
    inputSchema: z.object({
      company: z.string().describe('Company whose draft to send (must have been drafted this session).'),
      to: z.string().optional().describe('Recipient override; else the drafted apply-to address.'),
    }),
    execute: async ({ company, to }) => {
      const slug = slugCompany(company);
      const draft = drafts.get(slug);
      if (!draft) throw new Error(`No draft for "${company}" this session — call draft_application_email first.`);
      if (!deps.mailer.available) {
        return { sent: false, reason: 'Gmail not configured — set GMAIL_USER and GMAIL_APP_PASSWORD in .env.' };
      }
      const recipient = (to || draft.to || '').trim();
      if (!recipient) return { sent: false, reason: 'No recipient address — pass `to`, or ensure the JD has an apply-to address.' };

      const attachNote = draft.attachments.length ? ` with ${draft.attachments[0]!.filename}` : ' (no résumé attached)';
      const ok = await deps.confirm(`Send the application email to ${recipient}${attachNote} from ${draft.from || deps.config.gmail?.user}?`);
      if (!ok) return { sent: false, reason: 'Cancelled — not sent.' };

      const res = await service.send(draft, { mailer: deps.mailer, to: recipient });
      return { sent: true, to: recipient, messageId: res.messageId, accepted: res.accepted, rejected: res.rejected };
    },
  });

  return { draft_application_email, send_application_email };
}
