// A tailored change to the résumé document, and the rule that lets it be
// applied: every rewritten line is checked against the fact base, and one that
// claims something unbacked keeps its original text. That check is what makes
// "rewrite every bullet" safe — the model gets the whole document, and anything
// it invents is dropped on the way back in rather than printed.
import { unbackedClaims } from '../profile/claims.js';
import type { Facts } from '../types.js';
import { markupToPlainText } from './markup.js';
import type { BulletEntry, Resume } from './schema.js';

export interface BulletEdit {
  id: string;
  text: string;
}

export interface ResumeEdit {
  roleTitle: string;
  /** Tagline phrases replacing the document's own. */
  subtitle: string[];
  summary: string;
  /** Only the bullets the model chose to rewrite, addressed by id. */
  bullets: BulletEdit[];
  rationale: string;
}

export interface RevertedEdit {
  /** A bullet id, or 'summary' / 'subtitle'. */
  id: string;
  unbacked: string[];
}

export interface EditResult {
  resume: Resume;
  /** What the edit changed, by id. */
  applied: string[];
  /** What it tried to change but could not back. */
  reverted: RevertedEdit[];
  /** Bullet ids the document does not have. */
  unknown: string[];
}

function entries(resume: Resume): BulletEntry[] {
  return [...resume.experience, ...resume.projects];
}

/** Apply a tailored edit, reverting anything the fact base does not support. */
export function applyResumeEdit(base: Resume, edit: ResumeEdit, facts: Facts): EditResult {
  const resume: Resume = structuredClone(base);
  const applied: string[] = [];
  const reverted: RevertedEdit[] = [];
  const unknown: string[] = [];

  const take = (id: string, text: string, source: string): boolean => {
    const unbacked = unbackedClaims(markupToPlainText(text), {
      facts,
      source: markupToPlainText(source),
    });
    if (unbacked.length) reverted.push({ id, unbacked });
    else applied.push(id);
    return unbacked.length === 0;
  };

  if (edit.summary.trim() && take('summary', edit.summary, base.summary)) {
    resume.summary = edit.summary.trim();
  }

  const subtitle = edit.subtitle.map((s) => s.trim()).filter(Boolean);
  if (subtitle.length && take('subtitle', subtitle.join(' | '), base.subtitle.join(' | '))) {
    resume.subtitle = subtitle;
  }

  for (const { id, text } of edit.bullets) {
    const entry = entries(resume).find((e) => e.bullets.some((b) => b.id === id));
    const bullet = entry?.bullets.find((b) => b.id === id);
    if (!bullet) {
      unknown.push(id);
      continue;
    }
    if (text.trim() && take(id, text, bullet.text)) bullet.text = text.trim();
  }

  return { resume, applied, reverted, unknown };
}
