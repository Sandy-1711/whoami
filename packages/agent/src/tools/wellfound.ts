// Wellfound tools — the per-JD application-box note and the standing profile.
// Both wrap WellfoundService and draw only from the verified fact base.
import { relative } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { WellfoundService } from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { cap } from './shared.js';

const rel = (root: string, p: string): string => relative(root, p).replace(/\\/g, '/');

export function wellfoundTools(deps: AgentDeps) {
  const service = new WellfoundService({ root: deps.root, presenter: deps.presenter });

  const wellfound_note = createTool({
    id: 'wellfound_note',
    description:
      'Draft the per-JD Wellfound application-box note (the "What interests you about this role?" ' +
      'box), grounded in the fact base. Saves to tailored/<company>/wellfound-message.txt. Returns ' +
      'the note, its word count, and the JD keywords it can truthfully lean on.',
    inputSchema: z.object({
      jd: z.string().describe('The full job description text.'),
      company: z.string().describe('Company name — files the note.'),
      role: z.string().optional().describe('Role override; omit to infer from the JD.'),
    }),
    execute: async ({ jd, company, role }) => {
      const llm = deps.registry.resolve(deps.config);
      const r = await service.message({ jd, company, role: role || '' }, { provider: llm });
      return {
        note: r.message,
        wordCount: r.wordCount,
        grounding: cap([...r.cls.matched, ...r.cls.addable]),
        gaps: cap(r.cls.missing),
        file: rel(deps.root, r.paths.file),
      };
    },
  });

  const wellfound_profile = createTool({
    id: 'wellfound_profile',
    description:
      'Generate or refresh the STANDING Wellfound profile — one document for every role (like ' +
      'LinkedIn): headline, bio, what-I\'m-looking-for, achievements, skills, and a blurb per role. ' +
      'Overwrites wellfound-profile.md. Use when the fact base changed or the user asks to update ' +
      'their Wellfound profile. Optional focus steers the emphasis.',
    inputSchema: z.object({
      target: z.string().optional().describe('Optional focus, e.g. "remote agent-infrastructure roles".'),
    }),
    execute: async ({ target }) => {
      const llm = deps.registry.resolve(deps.config);
      const r = await service.profile({ target: target || '' }, { provider: llm });
      return {
        headline: r.profile.headline,
        bio: r.profile.bio,
        bioChars: r.profile.bio.length,
        skills: cap(r.profile.skills),
        file: r.relPath,
      };
    },
  });

  return { wellfound_note, wellfound_profile };
}
