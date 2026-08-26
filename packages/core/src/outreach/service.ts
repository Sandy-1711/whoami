// OutreachService — the short copy a job search needs a human to read: a cold
// email, a LinkedIn DM, a follow-up, a referral ask, and the note an application
// form asks for in its free-text box. All grounded in the fact base, optionally
// anchored to a JD, and saved under tailored/<company>/ when a company is given.
//
// The note is the one that scores the JD first, because it is written against a
// specific posting and reports what it could truthfully lean on.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmError, type Llm } from '@resume/llm';
import type { Presenter } from '../ports/logger.js';
import { slugCompany, extractRoleFromJd } from '../naming.js';
import { loadProfileDigestText } from '../profile/loaders.js';
import { drift } from '../profile/sources.js';
import { extractJdKeywords, classify, scoreResume } from '../tailor/core.js';
import { resumePlainText } from '../resume/schema.js';
import { loadResume } from '../resume/store.js';
import {
  outreachPrompt, OUTREACH_SCHEMA, type OutreachResponse, type OutreachKind,
  applicationNotePrompt, APPLICATION_NOTE_SCHEMA, type CopyTone, type CopyLength,
} from '../prompts.js';
import type { Facts, Classification, Score } from '../types.js';

export interface OutreachRequest {
  kind: OutreachKind;
  company?: string;
  role?: string;
  jd?: string;
  // Freeform context: who it's to, prior touch, why now, etc.
  context?: string;
  // How it should sound and how long it runs — the user's call, not the fact
  // base's. Length scales the kind's own budget rather than replacing it.
  tone?: CopyTone;
  length?: CopyLength;
}

export interface OutreachResult {
  kind: OutreachKind;
  subject: string;
  message: string;
  wordCount: number;
  rationale: string;
  // Written only when a company was given (else the message is ad-hoc).
  file: string | null;
  relPath: string | null;
}

// ---- application-form note (per JD) ----------------------------------------

export interface ApplicationNoteRequest {
  jd: string;
  company: string;
  role?: string;
  tone?: CopyTone;
  length?: CopyLength;
  // Where the note will be pasted — "Wellfound", "Work at a Startup", "Lever".
  // Names the destination in the prompt and the filename; nothing branches on it.
  platform?: string;
}

export interface ApplicationNoteResult {
  role: string;
  platform: string;
  message: string;
  wordCount: number;
  rationale: string;
  cls: Classification;
  score: Score;
  paths: { slug: string; dir: string; relDir: string; file: string; relPath: string };
}

export interface OutreachServiceDeps {
  root: string;
  presenter: Presenter;
}

export interface OutreachRunContext {
  llm: Llm;
}

const wordCount = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

export class OutreachService {
  constructor(private readonly deps: OutreachServiceDeps) {}

  async generate(request: OutreachRequest, ctx: OutreachRunContext): Promise<OutreachResult> {
    const { root, presenter } = this.deps;
    const { llm } = ctx;
    const model = llm.describe();
    const { kind, company = '', role: roleOverride = '', jd = '', context = '', tone, length } = request;

    const facts: Facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
    const role = roleOverride || (jd ? extractRoleFromJd(jd) : '') || '';
    // Ranked GitHub/LinkedIn evidence so the message cites real repos/PRs.
    const digest = await loadProfileDigestText(root);

    const spin = presenter.spinner(`Asking ${model.label} (${model.modelId}) to write a ${kind.replace('_', ' ')}…`);
    let parsed: OutreachResponse;
    try {
      ({ object: parsed } = await llm.generateJson({
        operation: `outreach-${kind}`,
        prompt: outreachPrompt({ kind, facts, company, role, jd, context, tone, length, digest }),
        schema: OUTREACH_SCHEMA,
      }));
      if (!parsed?.message?.trim()) throw new Error('empty message');
      spin.succeed(`${model.label} wrote the ${kind.replace('_', ' ')}.`);
    } catch (err) {
      spin.fail(err instanceof LlmError ? err.describe() : (err as Error).message);
      throw err;
    }

    const subject = (parsed.subject || '').trim();
    const message = parsed.message.trim();

    let file: string | null = null;
    let relPath: string | null = null;
    if (company.trim()) {
      const slug = slugCompany(company);
      const dir = join(root, 'tailored', slug);
      await mkdir(dir, { recursive: true });
      file = join(dir, `outreach-${kind}.txt`);
      relPath = `tailored/${slug}/outreach-${kind}.txt`;
      await writeFile(file, (subject ? `Subject: ${subject}\n\n` : '') + message + '\n');
    }

    return { kind, subject, message, wordCount: wordCount(message), rationale: (parsed.rationale || '').trim(), file, relPath };
  }

  // The free-text note an application form asks for, written against one posting.
  async note(request: ApplicationNoteRequest, ctx: OutreachRunContext): Promise<ApplicationNoteResult> {
    const { root, presenter } = this.deps;
    const { llm } = ctx;
    const model = llm.describe();
    const { jd, company, role: roleOverride = '', platform = '', tone, length } = request;

    if (!jd || jd.trim().length < 20) throw new Error('JD text looks too short to analyze.');
    if (!company || !company.trim()) throw new Error('No company given — pass --company "Acme AI".');

    const facts: Facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
    const resumeText = resumePlainText(await loadResume(root));
    await this.warnDrift();

    // Deterministic keyword read so the note leans on real matches, never a gap.
    const cls = classify(extractJdKeywords(jd), resumeText, facts);
    const score = scoreResume(cls);
    const role = roleOverride || extractRoleFromJd(jd) || 'Software Engineer';
    const digest = await loadProfileDigestText(root);

    const where = platform.trim() || 'the application form';
    const spin = presenter.spinner(`Asking ${model.label} (${model.modelId}) to draft the note for ${where}…`);
    let message: string, rationale: string;
    try {
      const { object: parsed } = await llm.generateJson({
        operation: 'application-note',
        prompt: applicationNotePrompt({ jd, company, role: roleOverride, platform, tone, length, facts, classification: cls, digest }),
        schema: APPLICATION_NOTE_SCHEMA,
      });
      message = parsed.message.trim();
      rationale = parsed.rationale.trim();
      if (!message) throw new Error('empty message');
      spin.succeed(`${model.label} drafted the note (${wordCount(message)} words).`);
    } catch (err) {
      spin.fail(err instanceof LlmError ? err.describe() : (err as Error).message);
      throw err;
    }

    const slug = slugCompany(company);
    const dir = join(root, 'tailored', slug);
    const name = platform.trim() ? `application-note-${slugCompany(platform)}.txt` : 'application-note.txt';
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), message + '\n');

    return {
      role, platform: platform.trim(), message, wordCount: wordCount(message), rationale, cls, score,
      paths: { slug, dir, relDir: `tailored/${slug}`, file: join(dir, name), relPath: `tailored/${slug}/${name}` },
    };
  }

  // The copy is only as fresh as facts.json — warn if the sources drifted.
  private async warnDrift(): Promise<void> {
    const { root, presenter } = this.deps;
    const d = await drift(root);
    if (!d.lock) presenter.note('No sync baseline yet — run `sync` after profile edits.');
    else if (!d.synced) presenter.warn(`Profile sources changed since last sync: ${d.changed.join(', ')}. Fact base may be stale.`);
  }
}
