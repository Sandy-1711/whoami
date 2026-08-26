// resume.tex → a résumé document. The inverse of render.ts, for the one-time
// migration of the hand-written source into profile/resume.json and for anyone
// who would rather edit the LaTeX and read the data back out.
//
// It parses the macro vocabulary the renderer emits (\resumeSubheading,
// \resumeProjectHeading, \resumeItem, the skills itemize) rather than LaTeX at
// large, and throws on anything it cannot account for — a silent partial
// extraction would drop résumé content on the floor.
import { parseResume, type Bullet, type Resume } from './schema.js';

interface Group {
  value: string;
  end: number;
}

// The balanced {…} beginning at or after `from`, skipping leading whitespace.
function readGroup(text: string, from: number): Group {
  let start = from;
  while (start < text.length && /\s/.test(text[start]!)) start++;
  if (text[start] !== '{') {
    throw new Error(`Expected a "{" group near: ${text.slice(from, from + 60).trim()}`);
  }
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\\') i++;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { value: text.slice(start + 1, i), end: i + 1 };
  }
  throw new Error(`Unbalanced braces near: ${text.slice(start, start + 60).trim()}`);
}

function readGroups(text: string, from: number, count: number): { values: string[]; end: number } {
  const values: string[] = [];
  let at = from;
  for (let i = 0; i < count; i++) {
    const group = readGroup(text, at);
    values.push(group.value);
    at = group.end;
  }
  return { values, end: at };
}

// The group following a command, or null when the command does not appear.
function groupAfter(text: string, command: string): Group | null {
  const at = text.indexOf(command);
  return at < 0 ? null : readGroup(text, at + command.length);
}

// The contents of a group whose first token is `opener` — {\Huge \bfseries Name}.
function groupLedBy(text: string, opener: string): string | null {
  const at = text.indexOf(`{${opener}`);
  return at < 0 ? null : readGroup(text, at).value.slice(opener.length);
}

// LaTeX → restricted markup: the escapes and the three markers, reversed. Runs
// on one field at a time, so whitespace can be collapsed without joining fields.
function unlatex(latex: string): string {
  return latex
    .replace(/\s+/g, ' ')
    .replace(/\\href\{([^{}]*)\}\{\\underline\{([^{}]*)\}\}/g, '[$2]($1)')
    .replace(/\\href\{([^{}]*)\}\{([^{}]*)\}/g, '[$2]($1)')
    .replace(/\\textbf\{([^{}]*)\}/g, '**$1**')
    .replace(/\\texttt\{([^{}]*)\}/g, '`$1`')
    .replace(/\\(?:underline|emph|textit)\{([^{}]*)\}/g, '$1')
    .replace(/\\textbackslash\{\}/g, '\\')
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .trim();
}

// A \href target carries only the escapes escapeUrl added; unlatex would read
// its hyphens as dashes.
function unescapeUrl(url: string): string {
  return url.replace(/\\([%#\\{}])/g, '$1').trim();
}

// Commas inside parentheses belong to the item ("AWS (Lambda, S3)").
function splitItems(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
    } else current += ch;
  }
  items.push(current.trim());
  return items.filter(Boolean);
}

function slug(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 4)
    .join('-');
  return base || 'entry';
}

// Unique within the document — ids are how an edit names a bullet.
function uniqueId(text: string, taken: Set<string>): string {
  const base = slug(text);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function bulletsOf(text: string, entryId: string): Bullet[] {
  const marker = '\\resumeItem{';
  const bullets: Bullet[] = [];
  let at = text.indexOf(marker);
  while (at >= 0) {
    const group = readGroup(text, at + marker.length - 1);
    bullets.push({ id: `${entryId}-${bullets.length + 1}`, text: unlatex(group.value) });
    at = text.indexOf(marker, group.end);
  }
  return bullets;
}

function stripComments(tex: string): string {
  return tex.split('\n').filter((line) => !/^\s*%/.test(line)).join('\n');
}

function between(text: string, open: string, close: string, what: string): string {
  const start = text.indexOf(open);
  const end = text.indexOf(close, start + open.length);
  if (start < 0 || end < 0) throw new Error(`Could not find ${what} in resume.tex.`);
  return text.slice(start + open.length, end);
}

function sectionBody(body: string, name: string): string {
  const marker = `\\section{${name}}`;
  const start = body.indexOf(marker);
  if (start < 0) return '';
  const rest = body.slice(start + marker.length);
  const next = rest.indexOf('\\section{');
  return next < 0 ? rest : rest.slice(0, next);
}

// Each \resumeSubheading with its four fields and the text up to the next one,
// which is where its bullets live.
function subheadings(section: string): { fields: string[]; body: string }[] {
  const marker = '\\resumeSubheading';
  const starts = [...section.matchAll(/\\resumeSubheading/g)].map((m) => m.index);
  return starts.map((start, i) => {
    const { values, end } = readGroups(section, start + marker.length, 4);
    return { fields: values, body: section.slice(end, starts[i + 1] ?? section.length) };
  });
}

function extractHeader(body: string): Pick<Resume, 'name' | 'subtitle' | 'contacts' | 'summary'> {
  const center = between(body, '\\begin{center}', '\\end{center}', 'the header block');
  const name = groupLedBy(center, '\\Huge \\bfseries');
  const subtitle = groupLedBy(center, '\\large');
  if (!name || !subtitle) throw new Error('Could not find the name or subtitle in resume.tex.');

  const contacts = between(center, '\\small', '\\\\[6pt]', 'the contact line')
    .split('\\,$\\bullet$\\,')
    .map(unlatex)
    .filter(Boolean);

  return {
    name: unlatex(name),
    subtitle: subtitle.split('$|$').map(unlatex).filter(Boolean),
    contacts,
    summary: unlatex(between(center, '\\\\[6pt]', '\\vspace{-8pt}', 'the summary line')),
  };
}

function extractProjects(body: string, taken: Set<string>): Resume['projects'] {
  const section = sectionBody(body, 'Projects');
  const marker = '\\resumeProjectHeading';
  const starts = [...section.matchAll(/\\resumeProjectHeading/g)].map((m) => m.index);

  return starts.map((start, i) => {
    const { values, end } = readGroups(section, start + marker.length, 2);
    const [heading = '', dates = ''] = values;
    const name = groupAfter(heading, '\\textbf');
    const tech = groupAfter(heading, '\\emph');
    const url = groupAfter(heading, '\\href');
    if (!name) throw new Error(`Project heading has no \\textbf{name}: ${heading}`);

    const id = uniqueId(unlatex(name.value), taken);
    return {
      id,
      name: unlatex(name.value),
      tech: tech ? unlatex(tech.value) : '',
      dates: unlatex(dates),
      ...(url
        ? { link: { label: unlatex(readGroup(heading, url.end).value), url: unescapeUrl(url.value) } }
        : {}),
      bullets: bulletsOf(section.slice(end, starts[i + 1] ?? section.length), id),
    };
  });
}

function extractSkills(body: string, taken: Set<string>): Resume['skills'] {
  const section = sectionBody(body, 'Technical Skills');
  const marker = '\\textbf{';
  const groups: Resume['skills'] = [];
  let at = section.indexOf(marker);
  while (at >= 0) {
    const label = readGroup(section, at + marker.length - 1);
    const items = readGroup(section, label.end);
    groups.push({
      id: uniqueId(unlatex(label.value), taken),
      label: unlatex(label.value),
      items: splitItems(unlatex(items.value).replace(/^:\s*/, '')),
    });
    at = section.indexOf(marker, items.end);
  }
  return groups;
}

/**
 * Parse a rendered résumé back into its data.
 * @throws Error when the source does not carry the macro shapes render.ts emits.
 */
export function extractResume(tex: string): Resume {
  const body = stripComments(between(tex, '\\begin{document}', '\\end{document}', 'the document body'));
  const taken = new Set<string>();

  const experience = subheadings(sectionBody(body, 'Experience')).map(({ fields, body: entry }) => {
    const [org = '', dates = '', role = '', location = ''] = fields.map(unlatex);
    const id = uniqueId(org, taken);
    return { id, org, dates, role, location, bullets: bulletsOf(entry, id) };
  });

  const projects = extractProjects(body, taken);
  const skills = extractSkills(body, taken);

  const education = subheadings(sectionBody(body, 'Education')).map(({ fields }) => {
    const [school = '', dates = '', degree = '', location = ''] = fields.map(unlatex);
    return { id: uniqueId(school, taken), school, dates, degree, location };
  });

  return parseResume({ ...extractHeader(body), experience, projects, skills, education });
}
