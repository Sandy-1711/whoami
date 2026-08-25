// OutreachService — short human-to-human messages for reaching out: a cold
// email, a LinkedIn DM, a follow-up, or a referral ask. Grounded in the fact
// base, optionally anchored to a JD. When a company is given, the message is
// saved to tailored/<company>/outreach-<kind>.txt for reuse.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LlmError, type Llm } from '@resume/llm';
import type { Presenter } from '../ports/logger.js';
import { slugCompany, extractRoleFromJd } from '../naming.js';
import { loadProfileDigestText } from '../profile/loaders.js';
import {
  outreachPrompt, OUTREACH_SCHEMA, type OutreachResponse, type OutreachKind,
} from '../prompts.js';
import type { Facts } from '../types.js';

export interface OutreachRequest {
  kind: OutreachKind;
  company?: string;
  role?: string;
  jd?: string;
  // Freeform context: who it's to, prior touch, why now, etc.
  context?: string;
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
    const { kind, company = '', role: roleOverride = '', jd = '', context = '' } = request;

    const facts: Facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
    const role = roleOverride || (jd ? extractRoleFromJd(jd) : '') || '';
    // Ranked GitHub/LinkedIn evidence so the message cites real repos/PRs.
    const digest = await loadProfileDigestText(root);

    const spin = presenter.spinner(`Asking ${model.label} (${model.modelId}) to write a ${kind.replace('_', ' ')}…`);
    let parsed: OutreachResponse;
    try {
      ({ object: parsed } = await llm.generateJson({
        operation: `outreach-${kind}`,
        prompt: outreachPrompt({ kind, facts, company, role, jd, context, digest }),
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
}
