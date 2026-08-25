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

const EDIT = z.object({
  op: z.enum(OPS).describe('The edit operation.'),
  value: z.string().describe('The keyword / skill / metric / title / identity value.'),
  category: z.string().optional().describe('Skill category (for add_skill / remove_skill).'),
  field: z.enum(IDENTITY_FIELDS).optional().describe('Identity field (for set_identity).'),
});

export function factsTools(deps: AgentDeps) {
  const update_facts = createTool({
    id: 'update_facts',
    description:
      'Edit the fact base (profile/facts.json): add or remove ATS keywords, skills (each needs a ' +
      'category), headline metrics, title variants, or set an identity field. Pass several edits at ' +
      'once — they apply together or not at all, so the file is never left half-updated. Only add ' +
      'things that are TRUE: this file grounds the résumé and every draft, and nothing may be ' +
      'claimed that is not in it. Identity edits require the user\'s confirmation. After a change ' +
      'that affects résumé wording, tell the user to edit resume.tex to match and to sync so drift ' +
      'is re-baselined.',
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
      if (identityTouched) {
        const ok = await deps.confirm(`${applied.map((a) => a.summary).join(' ')} This edits your verified identity — proceed?`);
        if (!ok) return { changed: false, edits: applied, summary: 'Cancelled — nothing written.' };
      }

      if (changed) await writeFile(path, JSON.stringify(facts, null, 2) + '\n');
      return {
        changed,
        edits: applied,
        summary: applied.map((a) => a.summary).join(' '),
        nextSteps: changed
          ? ['If this affects résumé wording, edit resume.tex to match, then run sync_profiles to re-baseline drift.']
          : [],
      };
    },
  });

  return { update_facts };
}
