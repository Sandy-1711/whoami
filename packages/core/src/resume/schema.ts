// The résumé as data. profile/resume.json is the source of truth; resume.tex is
// rendered from it (see render.ts). Every prose field carries restricted markup
// (see markup.ts) and is escaped at render time, so nothing here can be LaTeX.
//
// Entries and bullets carry a stable `id`. That is what tailoring addresses when
// it rewrites a bullet, and what lets a rewrite be checked against the fact base
// before it reaches the page.
import { z } from 'zod';
import { markupToPlainText } from './markup.js';

const id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase kebab-case (letters, digits, hyphens)');

const prose = z.string().min(1);
const line = z.string().default('');

export const BULLET_SCHEMA = z.object({
  id,
  text: prose,
});

export const EXPERIENCE_SCHEMA = z.object({
  id,
  org: prose,
  role: prose,
  dates: line,
  location: line,
  bullets: z.array(BULLET_SCHEMA).default([]),
});

export const PROJECT_SCHEMA = z.object({
  id,
  name: prose,
  /** Comma-separated stack shown beside the name; '' hides it. */
  tech: line,
  dates: line,
  /** Optional repo/demo link rendered after the stack. */
  link: z.object({ label: prose, url: z.string().min(1) }).optional(),
  bullets: z.array(BULLET_SCHEMA).default([]),
});

export const SKILL_GROUP_SCHEMA = z.object({
  id,
  label: prose,
  items: z.array(z.string().min(1)).min(1),
});

export const EDUCATION_SCHEMA = z.object({
  id,
  school: prose,
  degree: prose,
  dates: line,
  location: line,
});

export const RESUME_SCHEMA = z
  .object({
    name: prose,
    /** Tagline phrases, rendered " | "-separated under the name. */
    subtitle: z.array(prose).min(1),
    /** Header links, bullet-separated. Each is prose — usually one [label](url). */
    contacts: z.array(prose).min(1),
    summary: prose,
    experience: z.array(EXPERIENCE_SCHEMA).default([]),
    projects: z.array(PROJECT_SCHEMA).default([]),
    skills: z.array(SKILL_GROUP_SCHEMA).default([]),
    education: z.array(EDUCATION_SCHEMA).default([]),
  })
  .superRefine((resume, ctx) => {
    const seen = new Set<string>();
    for (const value of documentIds(resume)) {
      if (seen.has(value)) {
        ctx.addIssue({ code: 'custom', message: `duplicate id "${value}"`, path: ['id'] });
      }
      seen.add(value);
    }
  });

export type Bullet = z.infer<typeof BULLET_SCHEMA>;
export type Experience = z.infer<typeof EXPERIENCE_SCHEMA>;
export type Project = z.infer<typeof PROJECT_SCHEMA>;
export type SkillGroup = z.infer<typeof SKILL_GROUP_SCHEMA>;
export type Education = z.infer<typeof EDUCATION_SCHEMA>;
export type Resume = z.infer<typeof RESUME_SCHEMA>;

/** An entry that owns bullets — the two sections tailoring may rewrite. */
export type BulletEntry = Experience | Project;

// Every id in the document, in reading order. Ids must be unique across
// sections, not only within one: an edit names a bullet by id alone.
function documentIds(resume: {
  experience: BulletEntry[];
  projects: BulletEntry[];
  skills: { id: string }[];
  education: { id: string }[];
}): string[] {
  const ids: string[] = [];
  for (const entry of [...resume.experience, ...resume.projects]) {
    ids.push(entry.id, ...entry.bullets.map((b) => b.id));
  }
  return [...ids, ...resume.skills.map((s) => s.id), ...resume.education.map((e) => e.id)];
}

/** Every bullet in the document, paired with the entry that owns it. */
export function resumeBullets(resume: Resume): { entry: BulletEntry; bullet: Bullet }[] {
  return [...resume.experience, ...resume.projects].flatMap((entry) =>
    entry.bullets.map((bullet) => ({ entry, bullet })),
  );
}

/** Everything the document says, as plain prose — what keyword scoring reads. */
export function resumePlainText(resume: Resume): string {
  const parts = [
    ...resume.subtitle,
    resume.summary,
    ...resume.experience.flatMap((e) => [e.org, e.role, ...e.bullets.map((b) => b.text)]),
    ...resume.projects.flatMap((p) => [p.name, p.tech, ...p.bullets.map((b) => b.text)]),
    ...resume.skills.flatMap((s) => [s.label, ...s.items]),
    ...resume.education.flatMap((e) => [e.school, e.degree]),
  ];
  return markupToPlainText(parts.join('\n'));
}

/**
 * Parse a résumé document, naming the offending field when it does not fit.
 * @throws Error listing each invalid path.
 */
export function parseResume(data: unknown): Resume {
  const result = RESUME_SCHEMA.safeParse(data);
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new Error(`resume.json is not a valid résumé:\n  ${problems.join('\n  ')}`);
}
