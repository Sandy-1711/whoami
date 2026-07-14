// Evidence-store tools. `ingest_evidence` rebuilds profile/evidence.json from the
// scraped sources + fact base (quality gate → extraction → dedup/merge);
// `list_evidence` reads the store back with curation applied. Ingest is an
// LLM+embedding-heavy, file-writing operation — it needs a Gemini key for the
// embedder — so the tool prechecks that and returns a clean message if it's
// missing rather than failing deep in the pipeline.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { IngestService, readEvidence, readCuration, curatedUnits, auditBuild } from '@resume/core';
import type { AgentDeps } from '../deps.js';
import { cap } from './shared.js';

export function evidenceTools(deps: AgentDeps) {
  const ingest_evidence = createTool({
    id: 'ingest_evidence',
    description:
      'Rebuild the canonical evidence store (profile/evidence.json) from the fact base + scraped ' +
      'GitHub/LinkedIn sources: seeds verified facts, runs the repo quality gate, extracts atomic ' +
      'claims, and merges near-duplicates. Writes the file for the user to review before committing. ' +
      'Needs a Gemini API key (embeddings). Refuses to overwrite an existing store unless force is ' +
      'set — warn the user that force discards any hand edits to evidence.json. Consider sync_profiles ' +
      'first if the scrape is stale.',
    inputSchema: z.object({
      force: z.boolean().optional().describe('Overwrite an existing evidence.json even if it holds hand-curated edits.'),
    }),
    execute: async ({ force }) => {
      if (!deps.config.llm.keys.gemini) {
        return { error: 'ingest needs a Gemini API key for embeddings — set GEMINI_API_KEY in .env.' };
      }
      const provider = deps.registry.resolve(deps.config);
      const service = new IngestService({ root: deps.root, presenter: deps.presenter });
      const r = await service.run({ force: force || false }, { provider, embedder: deps.embedder });
      return {
        file: r.relPath,
        reposKept: r.reposKept,
        reposDropped: r.reposDropped,
        reposBanned: r.reposBanned,
        seedUnits: r.seedUnits,
        extractedUnits: r.extractedUnits,
        duplicatesMerged: r.duplicatesMerged,
        totalUnits: r.mergedUnits,
        note: 'Review profile/evidence.json, then commit it. Pin/ban repos in profile/curation.json.',
      };
    },
  });

  const list_evidence = createTool({
    id: 'list_evidence',
    description:
      'Read the evidence store (profile/evidence.json) with curation applied: total units, tier ' +
      'counts, and the top units by quality (claim, skills, tier, score). Use to see what proof is ' +
      'available before tailoring, or to check whether ingest has run.',
    inputSchema: z.object({
      limit: z.number().int().positive().optional().describe('How many top units to return (default 20).'),
    }),
    execute: async ({ limit }) => {
      const store = await readEvidence(deps.root);
      if (!store.units.length) {
        return { totalUnits: 0, note: 'Evidence store is empty — run ingest_evidence to build it.' };
      }
      const curation = await readCuration(deps.root);
      const units = curatedUnits(store, curation);
      const pinned = units.filter((u) => u.tier === 'pinned').length;
      return {
        totalUnits: store.units.length,
        available: units.length, // after dropping banned
        pinned,
        banned: store.units.length - units.length,
        top: cap(
          units.slice(0, limit ?? 20).map((u) => ({
            claim: u.claim,
            skills: u.skills.slice(0, 6),
            tier: u.tier,
            quality: Number(u.quality_score.toFixed(2)),
            sources: u.provenance.map((p) => `${p.source}:${p.ref}`).slice(0, 3),
          })),
          limit ?? 20,
        ),
      };
    },
  });

  const audit_build = createTool({
    id: 'audit_build',
    description:
      "Replay a tailored build's lockfile (tailored/<slug>/build.lock.json) to verify it is still " +
      'trustworthy before the user submits it: every selected evidence unit still exists (grounding), ' +
      'the page/width guards passed, the tailored PDF is still one page, and whether resume.tex or ' +
      'weights drifted since. Use after a --coverage tailor, or before an application goes out.',
    inputSchema: z.object({
      slug: z.string().describe('The company slug of the tailored build (see tailored/ or list_outputs).'),
    }),
    execute: async ({ slug }) => {
      const r = await auditBuild({ root: deps.root, slug, pdf: deps.pdf });
      return {
        slug: r.slug,
        found: r.found,
        pass: r.pass,
        checks: r.checks.map((c) => ({ name: c.name, pass: c.pass, critical: c.critical, detail: c.detail })),
      };
    },
  });

  return { ingest_evidence, list_evidence, audit_build };
}
