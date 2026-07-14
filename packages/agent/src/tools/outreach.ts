// outreach_message — write a short cold email, LinkedIn DM, follow-up, or referral
// ask, grounded in the fact base and optionally a JD. Saves to
// tailored/<company>/outreach-<kind>.txt when a company is given.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { OutreachService } from '@resume/core';
import type { AgentDeps } from '../deps.js';

export function outreachTools(deps: AgentDeps) {
  const outreach_message = createTool({
    id: 'outreach_message',
    description:
      'Write a short outreach message for the job hunt: a cold_email to a hiring manager/founder, a ' +
      'linkedin_dm, a followup after applying, or a referral_ask to a contact. Grounded in the fact ' +
      'base; pass a JD to anchor it to a role, and context for who it\'s to / prior touches. Saves to ' +
      'tailored/<company>/outreach-<kind>.txt when a company is given.',
    inputSchema: z.object({
      kind: z.enum(['cold_email', 'linkedin_dm', 'followup', 'referral_ask']).describe('The kind of message.'),
      company: z.string().optional().describe('Company name — files the message when given.'),
      role: z.string().optional().describe('Target role; omit to infer from the JD.'),
      jd: z.string().optional().describe('Optional job description to anchor the message.'),
      context: z.string().optional().describe('Who it\'s to, prior touch, why now, etc.'),
    }),
    execute: async ({ kind, company, role, jd, context }) => {
      const llm = deps.registry.resolve(deps.config);
      const service = new OutreachService({ root: deps.root, presenter: deps.presenter });
      const r = await service.generate({ kind, company, role, jd, context }, { provider: llm });
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
