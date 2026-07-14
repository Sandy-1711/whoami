// OutreachService — short human-to-human messages for reaching out: a cold
// email, a LinkedIn DM, a follow-up, or a referral ask. Grounded in the fact
// base, optionally anchored to a JD. When a company is given, the message is
// saved to tailored/<company>/outreach-<kind>.txt for reuse.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmProvider } from '../ports/llm.js';
import type { Presenter } from '../ports/logger.js';
import { slugCompany, extractRoleFromJd } from '../naming.js';
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
  provider: LlmProvider;
}

const wordCount = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

export class OutreachService {
  constructor(private readonly deps: OutreachServiceDeps) {}

  async generate(request: OutreachRequest, ctx: OutreachRunContext): Promise<OutreachResult> {
    const { root, presenter } = this.deps;
    const { provider } = ctx;
    const { kind, company = '', role: roleOverride = '', jd = '', context = '' } = request;

    const facts: Facts = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
    const role = roleOverride || (jd ? extractRoleFromJd(jd) : '') || '';

    const spin = presenter.spinner(`Asking ${provider.label} (${provider.model}) to write a ${kind.replace('_', ' ')}…`);
    let parsed: OutreachResponse;
    try {
      parsed = await provider.generateJson<OutreachResponse>({
        prompt: outreachPrompt({ kind, facts, company, role, jd, context }),
        schema: OUTREACH_SCHEMA,
      });
      if (!parsed?.message?.trim()) throw new Error('empty message');
      spin.succeed(`${provider.label} wrote the ${kind.replace('_', ' ')}.`);
    } catch (err) {
      spin.fail(`${provider.label} failed: ${(err as Error).message}`);
      throw new Error(`Check the ${provider.label} API key / quota / model name and retry.`);
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
