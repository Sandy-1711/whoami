// update_facts — the only way the agent edits the fact base, and it does so
// through validated, typed operations (never a free rewrite). Every edit passes
// through the confirm gate, which shows the user each one resolved to what it
// would actually change: this file is the verified profile the résumé and every
// draft draw from, so a wrong entry propagates everywhere.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { applyFactsEdit, IDENTITY_FIELDS, type Facts, type FactsEdit } from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { describeTool } from './describe.js';

const OPS = [
  'add_keyword', 'remove_keyword', 'add_skill', 'remove_skill',
  'add_headline_metric', 'remove_headline_metric',
  'add_title_variant', 'remove_title_variant', 'set_identity',
] as const;

const EDIT = z.object({
  op: z.enum(OPS).describe('The edit operation.'),
  value: z.string().describe('The keyword / skill / metric / title / identity value.'),
  category: z.string().optional().describe('Skill category (for add_skill / remove_skill).'),
  field: z.enum(IDENTITY_FIELDS).optional().describe('Identity field (for set_identity).'),
});

export function factsTools(deps: AgentDeps) {
  const update_facts = createTool({
    id: 'update_facts',
    description: describeTool({
      does:
        'Edit the fact base (profile/facts.json): add or remove ATS keywords, skills (each needs a ' +
        'category), headline metrics, title variants, or set an identity field. Several edits apply ' +
        'together or not at all, so the file is never left half-written.',
      cost: 'local',
      use: 'the user states something true about themselves that the fact base does not carry yet.',
      avoid:
        'anything you inferred, assumed, or read off a job description. This file is what every other ' +
        'tool is allowed to claim, so a wrong entry propagates into the résumé and every draft.',
      needs: "the user's approval, which is asked for with every edit spelled out.",
      then: 'if the change affects résumé wording, profile/resume.json must be edited to match, then sync_profiles to re-baseline drift.',
    }),
    inputSchema: z.object({
      edits: z.array(EDIT).min(1).describe('The edits to apply, in order.'),
    }),
    execute: async ({ edits }) => {
      const path = join(deps.root, 'profile', 'facts.json');
      const original: Facts = JSON.parse(await readFile(path, 'utf8'));

      // Fold every edit over an in-memory copy first: one invalid edit in the
      // batch must not leave the earlier ones on disk.
      let facts = original;
      const applied: { summary: string; changed: boolean }[] = [];
      let identityTouched = false;
      for (const edit of edits) {
        const result = applyFactsEdit(facts, edit as FactsEdit);
        facts = result.facts;
        identityTouched ||= (result.identity && result.changed);
        applied.push({ summary: result.summary, changed: result.changed });
      }

      const changed = applied.some((a) => a.changed);
      if (changed) {
        // Each summary is what the edit resolved to, so the user approves the
        // real effect rather than the operation names that were passed in.
        const ok = await deps.confirm({
          tool: 'update_facts',
          action: `Apply ${applied.length} edit(s) to the fact base`,
          params: {
            file: 'profile/facts.json',
            identity: identityTouched ? 'YES — this changes your verified identity (name, email, links)' : undefined,
          },
          preview: applied.filter((a) => a.changed).map((a) => a.summary).join('\n'),
        });
        if (!ok) return { changed: false, edits: applied, summary: 'Cancelled — nothing written.' };
        await writeFile(path, JSON.stringify(facts, null, 2) + '\n');
      }
      return {
        changed,
        edits: applied,
        summary: applied.map((a) => a.summary).join(' '),
        nextSteps: changed
          ? ['If this affects résumé wording, edit profile/resume.json to match, then run sync_profiles to re-baseline drift.']
          : [],
      };
    },
  });

  return { update_facts };
}
