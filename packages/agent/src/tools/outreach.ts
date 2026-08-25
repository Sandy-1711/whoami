// outreach_message — one tool for every short piece of job-search copy: the note
// an application form asks for, a cold email, a LinkedIn DM, a follow-up, or a
// referral ask. `kind` is the only axis that varies, so it is a parameter rather
// than a tool apiece.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { OutreachService } from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { cap } from './shared.js';
import { JD_INPUT_SHAPE, resolveJd, resolveOptionalJd } from './inputs.js';

const KINDS = ['application_note', 'cold_email', 'linkedin_dm', 'followup', 'referral_ask'] as const;

export function outreachTools(deps: AgentDeps) {
  const outreach_message = createTool({
    id: 'outreach_message',
    description:
      'Write one short piece of job-search copy, grounded in the fact base: an application_note ' +
      '(the free-text "What interests you about this role?" box on Wellfound, Work at a Startup, ' +
      'Lever, Greenhouse — needs a JD and a company), a cold_email to a hiring manager or founder, ' +
      'a linkedin_dm, a followup after applying, or a referral_ask to a contact. Pass a JD to ' +
      'anchor it to a role and `context` for who it is to and what has already passed between you. ' +
      'Saves under tailored/<company>/ when a company is given. For a full application email with ' +
      'the résumé attached, use draft_application_email instead.',
    inputSchema: z.object({
      kind: z.enum(KINDS).describe('The kind of message. application_note requires a JD and a company.'),
      company: z.string().optional().describe('Company name — files the message when given; required for application_note.'),
      role: z.string().optional().describe('Target role; omit to infer from the JD.'),
      platform: z.string().optional().describe('For application_note: where it will be pasted ("Wellfound", "Work at a Startup"). Names the destination and the file.'),
      ...JD_INPUT_SHAPE,
      context: z.string().optional().describe('Who it\'s to, prior touch, why now, etc.'),
    }),
    execute: async ({ kind, company, role, platform, context, ...jdInput }) => {
      const service = new OutreachService({ root: deps.root, presenter: deps.presenter });
      if (kind === 'application_note') {
        if (!company?.trim()) throw new Error('An application_note is written for one posting — pass `company`.');
        const jd = await resolveJd(deps.root, jdInput);
        const r = await service.note({ jd, company, role, platform }, { llm: deps.llm });
        return {
          kind, subject: null, message: r.message, wordCount: r.wordCount,
          platform: r.platform || null,
          // Scoring the JD first is what lets the note report what it could
          // truthfully lean on, and what it must not claim.
          grounding: cap([...r.cls.matched, ...r.cls.addable]),
          gaps: cap(r.cls.missing),
          file: r.paths.relPath,
        };
      }
      const jd = await resolveOptionalJd(deps.root, jdInput);
      const r = await service.generate({ kind, company, role, jd, context }, { llm: deps.llm });
      return {
        kind: r.kind,
        subject: r.subject || null,
        message: r.message,
        wordCount: r.wordCount,
        file: r.relPath,
      };
    },
  });

  return { outreach_message };
}
