// WellfoundService — turns a Wellfound job description into (1) the short note
// for the application box and (2) a suggested profile refresh, both grounded in
// the verified fact base. Wellfound has no job-seeker API, so this stops at
// generating copy the user pastes in; it renders nothing vendor- or
// terminal-specific and returns a structured result for the CLI to draw.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmProvider } from '../ports/llm.js';
import type { Presenter } from '../ports/logger.js';
import {
  extractJdKeywords, classify, scoreResume, latexToPlainText,
} from '../tailor/core.js';
import { slugCompany, extractRoleFromJd } from '../naming.js';
import { drift } from '../profile/sources.js';
import {
  wellfoundMessagePrompt, WELLFOUND_MESSAGE_SCHEMA, type WellfoundMessageResponse,
  wellfoundProfilePrompt, WELLFOUND_PROFILE_SCHEMA, mapWellfoundProfile,
  type WellfoundProfileResponse,
} from '../prompts.js';
import type { Facts, Classification, Score, WellfoundProfile } from '../types.js';

export interface WellfoundRequest {
  jd: string;
  company: string;
  role?: string;
  // Skip the profile draft and only produce the application-box note.
  messageOnly?: boolean;
}

export interface WellfoundRunContext {
  provider: LlmProvider;
}

export interface WellfoundPaths {
  slug: string;
  dir: string;
  relDir: string;
  message: string;    // absolute path to wellfound-message.txt
  profile: string;    // absolute path to wellfound-profile.md
}

export interface WellfoundRunResult {
  role: string;
  message: string;
  wordCount: number;
  messageRationale: string;
  profile: WellfoundProfile | null;
  profileRationale: string;
  cls: Classification;
  score: Score;
  paths: WellfoundPaths;
  wroteProfile: boolean;
}

export interface WellfoundServiceDeps {
  root: string;
  presenter: Presenter;
}

const wordCount = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

export class WellfoundService {
  constructor(private readonly deps: WellfoundServiceDeps) {}

  async run(request: WellfoundRequest, ctx: WellfoundRunContext): Promise<WellfoundRunResult> {
    const { root, presenter } = this.deps;
    const { provider } = ctx;
    const { jd, company, role: roleOverride = '', messageOnly = false } = request;

    if (!jd || jd.trim().length < 20) throw new Error('JD text looks too short to analyze.');
    if (!company || !company.trim()) throw new Error('No company given — pass --company "Acme AI".');

    const facts: Facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
    const resumeText = latexToPlainText(await readFile(join(root, 'resume.tex'), 'utf8'));

    // Drift warning — the copy is only as fresh as facts.json (source of truth).
    const d = await drift(root);
    if (!d.lock) presenter.note('No sync baseline yet — run `sync` after profile edits.');
    else if (!d.synced) presenter.warn(`Profile sources changed since last sync: ${d.changed.join(', ')}. Fact base may be stale.`);

    // Deterministic keyword read so the note leans on real matches, never a gap.
    const jdKeywords = extractJdKeywords(jd);
    const cls = classify(jdKeywords, resumeText, facts);
    const score = scoreResume(cls);
    const role = roleOverride || extractRoleFromJd(jd) || 'Software Engineer';

    // ---- application-box message -----------------------------------------
    const spin = presenter.spinner(`Asking ${provider.label} (${provider.model}) to draft the Wellfound note…`);
    let message: string, messageRationale: string;
    try {
      const parsed = await provider.generateJson<WellfoundMessageResponse>({
        prompt: wellfoundMessagePrompt({ jd, company, role: roleOverride, facts, classification: cls }),
        schema: WELLFOUND_MESSAGE_SCHEMA,
      });
      message = (parsed.message || '').trim();
      messageRationale = (parsed.rationale || '').trim();
      if (!message) throw new Error('empty message');
      spin.succeed(`${provider.label} drafted the application note (${wordCount(message)} words).`);
    } catch (err) {
      spin.fail(`${provider.label} failed: ${(err as Error).message}`);
      throw new Error(`Check the ${provider.label} API key / quota / model name and retry.`);
    }

    // ---- profile refresh (optional) --------------------------------------
    let profile: WellfoundProfile | null = null;
    let profileRationale = '';
    if (!messageOnly) {
      const spinP = presenter.spinner(`Asking ${provider.label} to optimize your Wellfound profile…`);
      try {
        const parsed = await provider.generateJson<WellfoundProfileResponse>({
          prompt: wellfoundProfilePrompt({ facts, target: jd }),
          schema: WELLFOUND_PROFILE_SCHEMA,
        });
        profile = mapWellfoundProfile(parsed);
        profileRationale = (parsed.rationale || '').trim();
        spinP.succeed(`${provider.label} suggested a profile refresh.`);
      } catch (err) {
        // The note is the headline deliverable — don't fail the whole run if the
        // profile pass errors; report and continue with what we have.
        spinP.warn(`Profile pass failed (${(err as Error).message}) — keeping the note only.`);
      }
    }

    // ---- write outputs ----------------------------------------------------
    const slug = slugCompany(company);
    const dir = join(root, 'tailored', slug);
    const paths: WellfoundPaths = {
      slug,
      dir,
      relDir: `tailored/${slug}`,
      message: join(dir, 'wellfound-message.txt'),
      profile: join(dir, 'wellfound-profile.md'),
    };
    await mkdir(dir, { recursive: true });
    await writeFile(paths.message, message + '\n');

    let wroteProfile = false;
    if (profile) {
      await writeFile(paths.profile, profileMarkdown(profile, profileRationale, company));
      wroteProfile = true;
    }

    return {
      role,
      message,
      wordCount: wordCount(message),
      messageRationale,
      profile,
      profileRationale,
      cls,
      score,
      paths,
      wroteProfile,
    };
  }
}

// The profile draft as a paste-ready markdown checklist. Never committed —
// tailored/ is gitignored — so it can carry the raw copy verbatim.
function profileMarkdown(p: WellfoundProfile, rationale: string, company: string): string {
  return [
    `# Wellfound profile draft`,
    ``,
    `Generated while applying to **${company}**. Paste these into your Wellfound`,
    `profile (Settings → your profile). This file is local-only (\`tailored/\` is gitignored).`,
    ``,
    `## Headline`,
    p.headline,
    ``,
    `## About`,
    p.about,
    ``,
    `## What I'm looking for`,
    p.lookingFor,
    ``,
    `## Skills — in priority order`,
    p.skills.length ? p.skills.map((s) => `- ${s}`).join('\n') : '_(none)_',
    ``,
    rationale ? `---\n\n**Why these changes:** ${rationale}` : '',
  ].join('\n') + '\n';
}
