// outreach_message — one tool for every short piece of job-search copy: the note
// an application form asks for, a cold email, a LinkedIn DM, a follow-up, or a
// referral ask. `kind` is the only axis that varies, so it is a parameter rather
// than a tool apiece.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { OutreachService, COPY_TONES, COPY_LENGTHS } from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { cap } from './shared.js';
import { JD_INPUT_SHAPE, resolveJd, resolveOptionalJd } from './inputs.js';
import { describeTool } from './describe.js';

const KINDS = ['application_note', 'cold_email', 'linkedin_dm', 'followup', 'referral_ask'] as const;

export function outreachTools(deps: AgentDeps) {
  const outreach_message = createTool({
    id: 'outreach_message',
    description: describeTool({
      does:
        'Write one short piece of job-search copy, grounded in the fact base: an application_note (the ' +
        'free-text "What interests you about this role?" box on Wellfound, Work at a Startup, Lever, ' +
        'Greenhouse), a cold_email to a hiring manager or founder, a linkedin_dm, a followup after ' +
        'applying, or a referral_ask. Pass a JD to anchor it to the role, and `context` for who it is ' +
        'to and what has already passed between you.',
      cost: 'llm',
      use: 'the user wants short copy to paste somewhere — a form, an inbox, a DM.',
      avoid: 'a full application email with the résumé attached — that is draft_application_email.',
      needs: "a JD and a company for application_note. `tone` and `length` are the user's call: ask_user rather than guess when it matters. The user is asked before the call is spent.",
      then: 'show it to them. Saved under tailored/<company>/ when a company was given, and recorded automatically.',
    }),
    inputSchema: z.object({
      kind: z.enum(KINDS).describe('The kind of message. application_note requires a JD and a company.'),
      company: z.string().optional().describe('Company name — files the message when given; required for application_note.'),
      role: z.string().optional().describe('Target role; omit to infer from the JD.'),
      platform: z.string().optional().describe('For application_note: where it will be pasted ("Wellfound", "Work at a Startup"). Names the destination and the file.'),
      ...JD_INPUT_SHAPE,
      context: z.string().optional().describe('Who it\'s to, prior touch, why now, etc.'),
      tone: z.enum(COPY_TONES).optional().describe('How it should sound. Default: direct.'),
      length: z.enum(COPY_LENGTHS).optional().describe('Scales the kind\'s own word budget; it never overrides a platform limit.'),
    }),
    execute: async ({ kind, company, role, platform, context, tone, length, ...jdInput }) => {
      const ok = await deps.confirm({
        tool: 'outreach_message',
        action: `Write a ${kind.replace(/_/g, ' ')}`,
        params: {
          company: company || '(none — an ad-hoc message)',
          role: role || '(read from the job description)',
          platform,
          tone: tone || 'direct (default)',
          length: length || 'standard (default)',
          context,
          cost: 'one model call',
        },
      });
      if (!ok) return { written: false, reason: 'Cancelled — nothing was written.' };
      const service = new OutreachService({ root: deps.root, presenter: deps.presenter });
      if (kind === 'application_note') {
        if (!company?.trim()) throw new Error('An application_note is written for one posting — pass `company`.');
        const jd = await resolveJd(deps.root, jdInput);
        const r = await service.note({ jd, company, role, platform, tone, length }, { llm: deps.llm });
        return {
          kind, subject: null, message: r.message, wordCount: r.wordCount,
          platform: r.platform || null,
          // Scoring the JD first is what lets the note report what it could
          // truthfully lean on, and what it must not claim.
          grounding: cap([...r.cls.matched, ...r.cls.addable]),
          gaps: cap(r.cls.missing),
          file: r.paths.relPath,
          nextSteps: r.cls.missing.length
            ? [`The note claims none of: ${cap(r.cls.missing, 8).join(', ')} — the fact base cannot back them.`]
            : [],
        };
      }
      const jd = await resolveOptionalJd(deps.root, jdInput);
      const r = await service.generate({ kind, company, role, jd, context, tone, length }, { llm: deps.llm });
      return {
        kind: r.kind,
        subject: r.subject || null,
        message: r.message,
        wordCount: r.wordCount,
        file: r.relPath,
        nextSteps: r.relPath
          ? ['Show it to the user. log_application once it actually goes out.']
          : ['Show it to the user. Pass a company next time to file it under tailored/<company>/.'],
      };
    },
  });

  return { outreach_message };
}
