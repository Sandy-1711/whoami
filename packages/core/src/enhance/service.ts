// EnhanceService — the "keep my profiles consistent" surface, upgraded to the
// architecture's Layer-4 drift detector (C29).
//
// It now generates surface copy FROM the evidence store (the canonical proof
// units), not just the fact base: LinkedIn headline/About/skills, a GitHub bio,
// and a GitHub profile-README "Highlights" section — all grounded in real units.
// Alongside the LLM copy it runs a DETERMINISTIC drift diff (computeDrift) of what
// the store implies should be live vs the current LinkedIn/GitHub scrape, and
// emits an exact stale/missing report. Paste-ready copy lands in
// linkedin-updates.md (gitignored); the README section can be pushed by the
// confirm-gated GitHub tool.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmProvider } from '../ports/llm.js';
import type { Presenter } from '../ports/logger.js';
import { drift as sourceDrift } from '../profile/sources.js';
import { enhancePrompt, ENHANCE_SCHEMA, type EnhanceResponse, type EnhanceUnit } from '../prompts.js';
import type { Facts, GithubData, LinkedinData } from '../types.js';
import { readEvidence, readCuration, curatedUnits } from '../evidence/store.js';
import { computeDrift, driftLines, type DriftItem } from '../evidence/drift.js';

export interface EnhanceRequest {
  // Optional focus to steer the positioning (e.g. "remote agent-infra").
  target?: string;
}

export interface EnhanceResult {
  linkedin: { headline: string; about: string; skillsToAdd: string[] };
  github: { bio: string; readme: string };
  drift: DriftItem[];        // deterministic, structured drift items
  staleOrMissing: string[];  // human-readable lines (deterministic drift + LLM extras)
  rationale: string;
  evidenceUnits: number;     // how many curated units grounded the copy
  path: string;              // absolute path to linkedin-updates.md
  relPath: string;
}

export interface EnhanceServiceDeps {
  root: string;
  presenter: Presenter;
}

export interface EnhanceRunContext {
  provider: LlmProvider;
}

export class EnhanceService {
  constructor(private readonly deps: EnhanceServiceDeps) {}

  async suggest(request: EnhanceRequest, ctx: EnhanceRunContext): Promise<EnhanceResult> {
    const { root, presenter } = this.deps;
    const { provider } = ctx;
    const target = (request.target || '').trim();

    const facts = await this.readJson<Facts>(join(root, 'profile', 'facts.json'));
    if (!facts) throw new Error('facts.json not found — cannot suggest without a fact base.');
    const linkedin = await this.readJson<LinkedinData>(join(root, 'profile', 'linkedin.json'));
    const github = await this.readJson<GithubData>(join(root, 'profile', 'github.json'));

    // Ground the copy in the evidence store when it exists; fall back to a
    // facts-only run (still works before `resume ingest`).
    const store = await readEvidence(root);
    const curation = await readCuration(root);
    const units = curatedUnits(store, curation);
    if (!units.length) presenter.warn('Evidence store is empty — grounding in facts.json only. Run `resume ingest` for evidence-backed copy.');

    // The suggestions are only as good as the scrape — warn when it's stale.
    const d = await sourceDrift(root);
    if (d.lock && !d.synced) presenter.warn(`Sources changed since last sync: ${d.changed.join(', ')} — suggestions may lag the live profile.`);

    // Deterministic drift: exactly what the store implies should be live but isn't.
    const driftItems = computeDrift({ units, linkedin, github });

    const enhanceUnits: EnhanceUnit[] = units.slice(0, 40).map((u) => ({
      claim: u.claim, skills: u.skills, impact: u.impact, tier: u.tier,
    }));

    const spin = presenter.spinner(`Asking ${provider.label} (${provider.model}) to generate copy from ${units.length} evidence unit${units.length === 1 ? '' : 's'}…`);
    let parsed: EnhanceResponse;
    try {
      parsed = await provider.generateJson<EnhanceResponse>({
        prompt: enhancePrompt({ facts, units: enhanceUnits, linkedin, github, target }),
        schema: ENHANCE_SCHEMA,
      });
      if (!parsed?.linkedin_headline) throw new Error('empty suggestions');
      spin.succeed(`${provider.label} produced profile copy + a drift report (${driftItems.length} item${driftItems.length === 1 ? '' : 's'}).`);
    } catch (err) {
      spin.fail(`${provider.label} failed: ${(err as Error).message}`);
      throw new Error(`Check the ${provider.label} API key / quota / model name and retry.`);
    }

    // The report merges the deterministic drift (authoritative, verifiable) with
    // any extra observations the model surfaced, deduped.
    const staleOrMissing = dedupeLines([
      ...driftLines(driftItems),
      ...(parsed.stale_or_missing || []).map((s) => s.trim()).filter(Boolean),
    ]);

    const result: EnhanceResult = {
      linkedin: {
        headline: (parsed.linkedin_headline || '').trim(),
        about: (parsed.linkedin_about || '').trim(),
        skillsToAdd: (parsed.linkedin_skills_to_add || []).map((s) => s.trim()).filter(Boolean),
      },
      github: {
        bio: (parsed.github_bio || '').trim(),
        readme: (parsed.github_readme || '').trim(),
      },
      drift: driftItems,
      staleOrMissing,
      rationale: (parsed.rationale || '').trim(),
      evidenceUnits: units.length,
      path: join(root, 'linkedin-updates.md'),
      relPath: 'linkedin-updates.md',
    };

    await writeFile(result.path, renderMarkdown(result, target));
    return result;
  }

  private async readJson<T>(path: string): Promise<T | null> {
    try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return null; }
  }
}

// Case-insensitive dedupe that preserves first-seen order.
function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const k = l.toLowerCase();
    if (!l || seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

// Paste-ready markdown. linkedin-updates.md is gitignored, so it carries the raw
// copy verbatim for the user to paste into LinkedIn / GitHub.
function renderMarkdown(r: EnhanceResult, target: string): string {
  const L: string[] = [
    '# Profile updates — paste-ready',
    '',
    `Generated from your evidence store (${r.evidenceUnits} unit${r.evidenceUnits === 1 ? '' : 's'}) vs the live LinkedIn/GitHub scrape${target ? ` (focus: _${target}_)` : ''}. Local-only — gitignored.`,
    '',
    '## LinkedIn — Headline',
    '', r.linkedin.headline, '',
    '## LinkedIn — About',
    '', r.linkedin.about, '',
    '## LinkedIn — Skills to add',
    '',
    r.linkedin.skillsToAdd.length ? r.linkedin.skillsToAdd.map((s) => `- ${s}`).join('\n') : '_(none)_',
    '',
    '## GitHub — Bio',
    '', r.github.bio, '',
    '## GitHub — Profile README (Highlights section)',
    '',
    r.github.readme || '_(none generated)_',
    '',
    '## Drift — stale or missing (fix these)',
    '',
    r.staleOrMissing.length ? r.staleOrMissing.map((s) => `- ${s}`).join('\n') : '_(nothing flagged)_',
    '',
  ];
  if (r.rationale) L.push('---', '', `**Why:** ${r.rationale}`, '');
  return L.join('\n');
}
