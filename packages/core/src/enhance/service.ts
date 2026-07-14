// EnhanceService — the "keep my profiles consistent" surface. It compares the
// verified fact base against the currently-live LinkedIn + GitHub scrapes and
// produces paste-ready copy (headline, about, bio) plus a list of what looks
// stale or missing. This is a lightweight take on the architecture's Layer 4
// drift detector; it writes suggestions to linkedin-updates.md (gitignored) for
// the user to paste in — LinkedIn/GitHub edits stay manual.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmProvider } from '../ports/llm.js';
import type { Presenter } from '../ports/logger.js';
import { drift } from '../profile/sources.js';
import { enhancePrompt, ENHANCE_SCHEMA, type EnhanceResponse } from '../prompts.js';
import type { Facts, GithubData, LinkedinData } from '../types.js';

export interface EnhanceRequest {
  // Optional focus to steer the positioning (e.g. "remote agent-infra").
  target?: string;
}

export interface EnhanceResult {
  linkedin: { headline: string; about: string; skillsToAdd: string[] };
  github: { bio: string };
  staleOrMissing: string[];
  rationale: string;
  path: string;      // absolute path to linkedin-updates.md
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

    // The suggestions are only as good as the scrape — warn when it's stale.
    const d = await drift(root);
    if (d.lock && !d.synced) presenter.warn(`Sources changed since last sync: ${d.changed.join(', ')} — suggestions may lag the live profile.`);

    const spin = presenter.spinner(`Asking ${provider.label} (${provider.model}) to compare your profiles to the fact base…`);
    let parsed: EnhanceResponse;
    try {
      parsed = await provider.generateJson<EnhanceResponse>({
        prompt: enhancePrompt({ facts, linkedin, github, target }),
        schema: ENHANCE_SCHEMA,
      });
      if (!parsed?.linkedin_headline) throw new Error('empty suggestions');
      spin.succeed(`${provider.label} produced profile suggestions.`);
    } catch (err) {
      spin.fail(`${provider.label} failed: ${(err as Error).message}`);
      throw new Error(`Check the ${provider.label} API key / quota / model name and retry.`);
    }

    const result: EnhanceResult = {
      linkedin: {
        headline: (parsed.linkedin_headline || '').trim(),
        about: (parsed.linkedin_about || '').trim(),
        skillsToAdd: (parsed.linkedin_skills_to_add || []).map((s) => s.trim()).filter(Boolean),
      },
      github: { bio: (parsed.github_bio || '').trim() },
      staleOrMissing: (parsed.stale_or_missing || []).map((s) => s.trim()).filter(Boolean),
      rationale: (parsed.rationale || '').trim(),
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

// Paste-ready markdown. linkedin-updates.md is gitignored, so it carries the raw
// copy verbatim for the user to paste into LinkedIn / GitHub.
function renderMarkdown(r: EnhanceResult, target: string): string {
  const L: string[] = [
    '# Profile updates — paste-ready',
    '',
    `Generated from your fact base vs the live LinkedIn/GitHub scrape${target ? ` (focus: _${target}_)` : ''}. Local-only — gitignored.`,
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
    '## Stale or missing (fix these)',
    '',
    r.staleOrMissing.length ? r.staleOrMissing.map((s) => `- ${s}`).join('\n') : '_(nothing flagged)_',
    '',
  ];
  if (r.rationale) L.push('---', '', `**Why:** ${r.rationale}`, '');
  return L.join('\n');
}
