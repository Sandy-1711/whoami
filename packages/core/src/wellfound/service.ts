// WellfoundService — two Wellfound artifacts, both grounded in the verified fact
// base. Wellfound has no job-seeker API, so this stops at generating copy the
// user pastes in.
//
//   message()  — the per-JD note for the "What interests you about this role?"
//                box. Written to tailored/<company>/wellfound-message.txt.
//   profile()  — the STANDING profile (one for every role, like LinkedIn):
//                headline, what-I'm-looking-for, about, skills, and a blurb per
//                role. Written to a single root wellfound-profile.md.
//
// It renders nothing vendor- or terminal-specific and returns structured results
// for the CLI to draw.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmProvider } from '../ports/llm.js';
import type { Presenter } from '../ports/logger.js';
import {
  extractJdKeywords, classify, scoreResume, latexToPlainText,
} from '../tailor/core.js';
import { slugCompany } from '../naming.js';
import { drift } from '../profile/sources.js';
import {
  wellfoundMessagePrompt, WELLFOUND_MESSAGE_SCHEMA, type WellfoundMessageResponse,
  wellfoundProfilePrompt, WELLFOUND_PROFILE_SCHEMA, mapWellfoundProfile,
  type WellfoundProfileResponse,
} from '../prompts.js';
import type { Facts, Classification, Score, WellfoundProfile } from '../types.js';

// ---- application-box note (per JD) -----------------------------------------

export interface WellfoundMessageRequest {
  jd: string;
  company: string;
  role?: string;
}

export interface WellfoundMessageResult {
  role: string;
  message: string;
  wordCount: number;
  rationale: string;
  cls: Classification;
  score: Score;
  paths: { slug: string; dir: string; relDir: string; file: string };
}

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
  provider: LlmProvider;
}

export interface WellfoundServiceDeps {
  root: string;
  presenter: Presenter;
}

const wordCount = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

export class WellfoundService {
  constructor(private readonly deps: WellfoundServiceDeps) {}

  // The short note for the application box — specific to one JD.
  async message(request: WellfoundMessageRequest, ctx: WellfoundRunContext): Promise<WellfoundMessageResult> {
    const { root, presenter } = this.deps;
    const { provider } = ctx;
    const { jd, company, role: roleOverride = '' } = request;

    if (!jd || jd.trim().length < 20) throw new Error('JD text looks too short to analyze.');
    if (!company || !company.trim()) throw new Error('No company given — pass --company "Acme AI".');

    const facts = await this.facts();
    const resumeText = latexToPlainText(await readFile(join(root, 'resume.tex'), 'utf8'));
    await this.warnDrift();

    // Deterministic keyword read so the note leans on real matches, never a gap.
    const jdKeywords = extractJdKeywords(jd);
    const cls = classify(jdKeywords, resumeText, facts);
    const score = scoreResume(cls);
    const { extractRoleFromJd } = await import('../naming.js');
    const role = roleOverride || extractRoleFromJd(jd) || 'Software Engineer';

    const spin = presenter.spinner(`Asking ${provider.label} (${provider.model}) to draft the Wellfound note…`);
    let message: string, rationale: string;
    try {
      const parsed = await provider.generateJson<WellfoundMessageResponse>({
        prompt: wellfoundMessagePrompt({ jd, company, role: roleOverride, facts, classification: cls }),
        schema: WELLFOUND_MESSAGE_SCHEMA,
      });
      message = (parsed.message || '').trim();
      rationale = (parsed.rationale || '').trim();
      if (!message) throw new Error('empty message');
      spin.succeed(`${provider.label} drafted the application note (${wordCount(message)} words).`);
    } catch (err) {
      spin.fail(`${provider.label} failed: ${(err as Error).message}`);
      throw new Error(`Check the ${provider.label} API key / quota / model name and retry.`);
    }

    const slug = slugCompany(company);
    const dir = join(root, 'tailored', slug);
    const file = join(dir, 'wellfound-message.txt');
    await mkdir(dir, { recursive: true });
    await writeFile(file, message + '\n');

    return {
      role, message, wordCount: wordCount(message), rationale, cls, score,
      paths: { slug, dir, relDir: `tailored/${slug}`, file },
    };
  }

  // The standing profile — one document for every role. Overwrites the single
  // master file so it improves as the fact base does.
  async profile(request: WellfoundProfileRequest, ctx: WellfoundRunContext): Promise<WellfoundProfileResult> {
    const { root, presenter } = this.deps;
    const { provider } = ctx;
    const target = (request.target || '').trim();

    const facts = await this.facts();
    await this.warnDrift();

    const spin = presenter.spinner(`Asking ${provider.label} (${provider.model}) to build your Wellfound profile…`);
    let profile: WellfoundProfile, rationale: string;
    try {
      const parsed = await provider.generateJson<WellfoundProfileResponse>({
        prompt: wellfoundProfilePrompt({ facts, target }),
        schema: WELLFOUND_PROFILE_SCHEMA,
      });
      profile = mapWellfoundProfile(parsed);
      rationale = (parsed.rationale || '').trim();
      if (!profile.headline || !profile.about) throw new Error('incomplete profile');
      spin.succeed(`${provider.label} built your Wellfound profile.`);
    } catch (err) {
      spin.fail(`${provider.label} failed: ${(err as Error).message}`);
      throw new Error(`Check the ${provider.label} API key / quota / model name and retry.`);
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
    `## What I'm looking for`,
    `_Wellfound → Job preferences → "What are you looking for?"_`,
    ``,
    p.lookingFor,
    ``,
    `> Also set the structured job-preference fields founders filter on: remote,`,
    `> role types, company stage, and salary expectations.`,
    ``,
    `## About`,
    ``,
    p.about,
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
