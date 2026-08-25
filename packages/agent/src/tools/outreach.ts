// outreach_message — one tool for every short piece of job-search copy: the
// Wellfound application-box note, a cold email, a LinkedIn DM, a follow-up, or a
// referral ask. `kind` is the only axis that varies, so it is a parameter rather
// than a tool apiece. The note is backed by WellfoundService (it scores the JD
// and files wellfound-message.txt); the rest by OutreachService.
import { relative } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { OutreachService, WellfoundService } from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { cap } from './shared.js';
import { JD_INPUT_SHAPE, resolveJd, resolveOptionalJd } from './inputs.js';

const rel = (root: string, p: string): string => relative(root, p).replace(/\\/g, '/');

const KINDS = ['wellfound_note', 'cold_email', 'linkedin_dm', 'followup', 'referral_ask'] as const;

export function outreachTools(deps: AgentDeps) {
  const outreach_message = createTool({
    id: 'outreach_message',
    description:
      'Write one short piece of job-search copy, grounded in the fact base: a wellfound_note (the ' +
      '"What interests you about this role?" application box — needs a JD and a company), a ' +
      'cold_email to a hiring manager or founder, a linkedin_dm, a followup after applying, or a ' +
      'referral_ask to a contact. Pass a JD to anchor it to a role and `context` for who it is to ' +
      'and what has already passed between you. Saves under tailored/<company>/ when a company is ' +
      'given. This is the tool for short outreach copy — for a full application email with the ' +
      'résumé attached use draft_application_email, and for the standing Wellfound profile use ' +
      'wellfound_profile.',
    inputSchema: z.object({
      kind: z.enum(KINDS).describe('The kind of message. wellfound_note requires a JD and a company.'),
      company: z.string().optional().describe('Company name — files the message when given; required for wellfound_note.'),
      role: z.string().optional().describe('Target role; omit to infer from the JD.'),
      ...JD_INPUT_SHAPE,
      context: z.string().optional().describe('Who it\'s to, prior touch, why now, etc.'),
    }),
    execute: async ({ kind, company, role, context, ...jdInput }) => {
      if (kind === 'wellfound_note') return wellfoundNote(deps, { company, role, jdInput });
      const jd = await resolveOptionalJd(deps.root, jdInput);
      const service = new OutreachService({ root: deps.root, presenter: deps.presenter });
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

interface NoteRequest {
  company?: string;
  role?: string;
  jdInput: { jd?: string; jdPath?: string; jdUrl?: string };
}

// The application-box note scores the JD first, so it also reports what it could
// truthfully lean on and what the JD wants that the fact base cannot back.
async function wellfoundNote(deps: AgentDeps, { company, role, jdInput }: NoteRequest) {
  if (!company?.trim()) throw new Error('A wellfound_note is written for one posting — pass `company`.');
  const jd = await resolveJd(deps.root, jdInput);
  const service = new WellfoundService({ root: deps.root, presenter: deps.presenter });
  const r = await service.message({ jd, company, role: role || '' }, { llm: deps.llm });
  return {
    kind: 'wellfound_note' as const,
    subject: null,
    message: r.message,
    wordCount: r.wordCount,
    grounding: cap([...r.cls.matched, ...r.cls.addable]),
    gaps: cap(r.cls.missing),
    file: rel(deps.root, r.paths.file),
  };
}
