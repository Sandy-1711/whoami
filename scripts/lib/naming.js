// Output naming for tailored résumés.
//
// Given a company name and a role, produce the folder + file layout the user
// wants:  tailored/<company_slug>/<Full Name> - <Role>.{pdf,tex,report.md}
//
//   company "Inteligen-ai" + role "AI Dev Engineer"
//     → tailored/inteligen_ai/Sandeep Singh - AI Dev Engineer.pdf
//
// Spaces/dashes in the final filename are fine for the user, but pdflatex is
// happier with a plain jobname, so the compile uses a separate safe name (see
// safeStem) and we copy the artifact to the pretty path afterwards.
import { join } from 'node:path';

// Company → folder slug: lowercase, runs of non-alphanumerics collapse to a
// single underscore, trimmed.  "Inteligen-ai" → "inteligen_ai".
export function slugCompany(name) {
  const s = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || 'company';
}

// A role fit for a filename: strip characters illegal on Windows/macOS paths,
// collapse whitespace. Falls back to "Software Engineer" per the spec.
export function sanitizeRole(role) {
  const cleaned = String(role || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Software Engineer';
}

// Safe stem for the LaTeX jobname (no spaces/specials): "inteligen_ai__ai_dev_engineer".
export function safeStem(slug, role) {
  const r = sanitizeRole(role).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${slug}__${r}`.slice(0, 80);
}

// Resolve every path the tailor writes for one run.
export function outputPaths(root, { company, fullName, role }) {
  const slug = slugCompany(company);
  const roleClean = sanitizeRole(role);
  const base = `${fullName} - ${roleClean}`;
  const dir = join(root, 'tailored', slug);
  const stem = safeStem(slug, roleClean);
  return {
    slug,
    role: roleClean,
    base,          // "Sandeep Singh - AI Dev Engineer"
    dir,           // absolute tailored/<slug>
    relDir: `tailored/${slug}`,
    tex: join(dir, `${base}.tex`),
    pdf: join(dir, `${base}.pdf`),
    report: join(dir, `${base}.report.md`),
    // Compile scratch (safe jobname) lives under build/, never shown to the user.
    buildTex: join(root, 'build', `${stem}.tex`),
    buildTexRel: `build/${stem}.tex`,
    buildPdf: join(root, 'build', `${stem}.pdf`),
    buildLog: join(root, 'build', `${stem}.log`),
  };
}

// Best-effort role extraction from a JD when no LLM is in the loop (offline
// mode). Looks for an explicit "Role/Position/Title:" line, then a "hiring a
// <Title>" phrase, then a standalone Title-Case line that ends in a job noun.
// Returns null when nothing convincing is found (caller supplies the fallback).
const JOB_NOUNS = 'Engineer|Developer|Scientist|Architect|Manager|Designer|Analyst|Lead|Intern|Consultant|Specialist';

export function extractRoleFromJd(jd) {
  const text = String(jd || '');

  const labeled = text.match(/^\s*(?:role|position|title|job\s*title)\s*[:\-–]\s*(.+)$/im);
  if (labeled) {
    const r = cleanRoleLine(labeled[1]);
    if (r) return r;
  }

  const hiring = text.match(
    new RegExp(`(?:hiring|seeking|looking for|for)\\s+(?:an?\\s+)?([A-Z][\\w/&+.-]*(?:\\s+[\\w/&+.-]+){0,4}?\\s+(?:${JOB_NOUNS}))`, 'm'),
  );
  if (hiring) {
    const r = cleanRoleLine(hiring[1]);
    if (r) return r;
  }

  const line = text.split('\n').map((l) => l.trim()).find(
    (l) => l.length <= 60 && new RegExp(`\\b(?:${JOB_NOUNS})\\b`, 'i').test(l) && /^[A-Z]/.test(l),
  );
  if (line) {
    const r = cleanRoleLine(line);
    if (r) return r;
  }

  return null;
}

function cleanRoleLine(s) {
  const r = String(s)
    .replace(/\(.*?\)/g, ' ')                 // drop parentheticals like "(Remote)"
    .replace(/[.,;|].*$/, ' ')                // cut at first hard punctuation
    .replace(/\b(remote|onsite|hybrid|full[-\s]?time|part[-\s]?time|contract)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return r && r.length >= 3 && r.length <= 50 ? r : null;
}
