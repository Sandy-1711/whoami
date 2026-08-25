// WellfoundService — the STANDING Wellfound profile (one for every role, like
// LinkedIn): headline, what-I'm-looking-for, about, skills, and a blurb per role,
// written to a single root wellfound-profile.md. Wellfound has no job-seeker API,
// so this stops at generating copy the user pastes in.
//
// The per-posting note is not here: it is the same note every application form
// asks for, so it lives with the rest of the short copy in OutreachService.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmError, type Llm } from '@resume/llm';
import type { Presenter } from '../ports/logger.js';
import { drift } from '../profile/sources.js';
import { loadProfileDigestText } from '../profile/loaders.js';
import {
  wellfoundProfilePrompt, WELLFOUND_PROFILE_SCHEMA, mapWellfoundProfile, WELLFOUND_BIO_MAX,
  type WellfoundProfileResponse,
} from '../prompts.js';
import type { Facts, WellfoundProfile } from '../types.js';

// ---- standing profile (one for every role) ---------------------------------

export interface WellfoundProfileRequest {
  // Optional focus (e.g. "remote agent-infra"); blank = use the fact base's own
  // positioning (title_variants / headline_metrics).
  target?: string;
}

export interface WellfoundProfileResult {
  profile: WellfoundProfile;
  rationale: string;
  path: string;      // absolute path to the master wellfound-profile.md
  relPath: string;
}

export interface WellfoundRunContext {
  llm: Llm;
}

export interface WellfoundServiceDeps {
  root: string;
  presenter: Presenter;
}

const wordCount = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

export class WellfoundService {
  constructor(private readonly deps: WellfoundServiceDeps) {}

  // The standing profile — one document for every role. Overwrites the single
  // master file so it improves as the fact base does.
  async profile(request: WellfoundProfileRequest, ctx: WellfoundRunContext): Promise<WellfoundProfileResult> {
    const { root, presenter } = this.deps;
    const { llm } = ctx;
    const model = llm.describe();
    const target = (request.target || '').trim();

    const facts = await this.facts();
    await this.warnDrift();
    const digest = await loadProfileDigestText(root);

    const spin = presenter.spinner(`Asking ${model.label} (${model.modelId}) to build your Wellfound profile…`);
    let profile: WellfoundProfile, rationale: string;
    try {
      const { object: parsed } = await llm.generateJson({
        operation: 'wellfound-profile',
        prompt: wellfoundProfilePrompt({ facts, target, digest }),
        schema: WELLFOUND_PROFILE_SCHEMA,
      });
      profile = mapWellfoundProfile(parsed);
      rationale = parsed.rationale.trim();
      if (!profile.headline || !profile.bio) throw new Error('incomplete profile');
      spin.succeed(`${model.label} built your Wellfound profile.`);
    } catch (err) {
      spin.fail(err instanceof LlmError ? err.describe() : (err as Error).message);
      throw err;
    }

    const path = join(root, 'wellfound-profile.md');
    await writeFile(path, profileMarkdown(profile, rationale, target));
    return { profile, rationale, path, relPath: 'wellfound-profile.md' };
  }

  private async facts(): Promise<Facts> {
    return JSON.parse(await readFile(join(this.deps.root, 'profile', 'facts.json'), 'utf8'));
  }

  // The copy is only as fresh as facts.json — warn if the sources drifted.
  private async warnDrift(): Promise<void> {
    const { root, presenter } = this.deps;
    const d = await drift(root);
    if (!d.lock) presenter.note('No sync baseline yet — run `sync` after profile edits.');
    else if (!d.synced) presenter.warn(`Profile sources changed since last sync: ${d.changed.join(', ')}. Fact base may be stale.`);
  }
}

// The standing profile as a paste-ready markdown doc. Never committed —
// wellfound-profile.md is gitignored — so it carries the raw copy verbatim.
function profileMarkdown(p: WellfoundProfile, rationale: string, target: string): string {
  const L: string[] = [
    `# Wellfound profile — master draft`,
    ``,
    `Your **standing** profile — the same one founders see for every role (like LinkedIn).`,
    `Regenerate anytime with \`pnpm wellfound-profile\`${target ? ` (focus: _${target}_)` : ''}. Local-only — this file is gitignored.`,
    ``,
    `## Headline`,
    `_Wellfound → Edit profile → headline._`,
    ``,
    p.headline,
    ``,
    `## Bio  (${p.bio.length}/${WELLFOUND_BIO_MAX} chars)`,
    `_Wellfound → Edit profile → bio. Capped at ${WELLFOUND_BIO_MAX} characters._`,
    ``,
    p.bio,
    ``,
    `## What I'm looking for`,
    `_Wellfound → Job preferences → "What are you looking for?"_`,
    ``,
    p.lookingFor,
    ``,
    `> Also set the structured job-preference fields founders filter on: remote,`,
    `> role types, company stage, and salary expectations.`,
    ``,
    `## Achievements — paste as bullets`,
    ``,
    p.achievements.length ? p.achievements.map((a) => `- ${a}`).join('\n') : '_(none)_',
    ``,
    `## Skills — add as tags, most important first`,
    ``,
    p.skills.length ? p.skills.map((s) => `- ${s}`).join('\n') : '_(none)_',
    ``,
    `## Experience blurbs — paste under each role`,
  ];
  if (p.experience.length) {
    for (const e of p.experience) {
      L.push('', `### ${e.label}`, '', e.blurb);
    }
  } else {
    L.push('', '_(none generated)_');
  }
  L.push('', rationale ? `---\n\n**Why these choices:** ${rationale}` : '');
  return L.join('\n') + '\n';
}
