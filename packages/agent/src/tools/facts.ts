// update_facts — the only way the agent edits the fact base, and it does so
// through validated, typed operations (never a free rewrite). Identity edits pass
// through the confirm gate because they change the verified profile the résumé
// and every draft draw from.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { applyFactsEdit, IDENTITY_FIELDS, type Facts, type FactsEdit } from '@resume/core';
import type { AgentDeps } from '../deps.js';

const OPS = [
  'add_keyword', 'remove_keyword', 'add_skill', 'remove_skill',
  'add_headline_metric', 'remove_headline_metric',
  'add_title_variant', 'remove_title_variant', 'set_identity',
] as const;

export function factsTools(deps: AgentDeps) {
  const update_facts = createTool({
    id: 'update_facts',
    description:
      'Make ONE validated edit to the fact base (profile/facts.json): add/remove an ATS keyword, a ' +
      'skill (needs a category), a headline metric, a title variant, or set an identity field. Only ' +
      'add things that are TRUE — this file grounds the résumé and every draft; never invent. ' +
      'Identity edits require the user\'s confirmation. After a change that affects résumé wording, ' +
      'remind the user to edit resume.tex to match and to sync to re-baseline drift.',
    inputSchema: z.object({
      op: z.enum(OPS).describe('The edit operation.'),
      value: z.string().describe('The keyword / skill / metric / title / identity value.'),
      category: z.string().optional().describe('Skill category (for add_skill / remove_skill).'),
      field: z.enum(IDENTITY_FIELDS).optional().describe('Identity field (for set_identity).'),
    }),
    execute: async ({ op, value, category, field }) => {
      const path = join(deps.root, 'profile', 'facts.json');
      const facts: Facts = JSON.parse(await readFile(path, 'utf8'));
      const edit = { op, value, category, field } as FactsEdit;
      const result = applyFactsEdit(facts, edit);

      if (result.identity && result.changed) {
        const ok = await deps.confirm(`${result.summary} This edits your verified identity — proceed?`);
        if (!ok) return { changed: false, summary: 'Cancelled — identity not changed.' };
      }

      if (result.changed) await writeFile(path, JSON.stringify(result.facts, null, 2) + '\n');
      return {
        changed: result.changed,
        summary: result.summary,
        reminder: result.changed
          ? 'If this affects résumé wording, edit resume.tex to match, then run sync_profiles to re-baseline drift.'
          : undefined,
      };
    },
  });

  return { update_facts };
}
