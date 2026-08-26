// Render a résumé document to LaTeX. Pure: JSON in, .tex source out, no I/O.
//
// The layout lives here and nowhere else — the data carries no formatting, only
// restricted markup, which is escaped on the way through. A section with no
// entries is dropped rather than emitted empty, because an itemize with no
// \item does not compile; the source guard then reports the missing section.
import { markupToLatex, latexLink } from './markup.js';
import { PREAMBLE } from './preamble.js';
import type { Bullet, Education, Experience, Project, Resume, SkillGroup } from './schema.js';

// String.raw so the LaTeX below reads exactly as it renders: \\ is a line break,
// not an escaped backslash.
const tex = String.raw;

function bulletList(items: Bullet[], indent: string): string[] {
  if (!items.length) return [];
  return [
    `${indent}\\resumeItemListStart`,
    ...items.map((b) => `${indent}  \\resumeItem{${markupToLatex(b.text)}}`),
    `${indent}\\resumeItemListEnd`,
  ];
}

function header(resume: Resume): string[] {
  const subtitle = resume.subtitle.map(markupToLatex).join(tex` $|$ `);
  const contacts = resume.contacts.map(markupToLatex);
  return [
    tex`\begin{center}`,
    tex`    {\Huge \bfseries ${markupToLatex(resume.name)}} \\ \vspace{2pt}`,
    tex`    {\large ${subtitle}} \\ \vspace{4pt}`,
    tex`    \small`,
    ...contacts.map((c, i) => `    ${c}${i < contacts.length - 1 ? tex` \,$\bullet$\,` : ''}`),
    tex`    \\[6pt]`,
    `    ${markupToLatex(resume.summary)}`,
    tex`    \vspace{-8pt}`,
    tex`\end{center}`,
    '',
  ];
}

function experienceSection(entries: Experience[]): string[] {
  if (!entries.length) return [];
  const body = entries.flatMap((entry) => [
    tex`    \resumeSubheading`,
    `      {${markupToLatex(entry.org)}}{${markupToLatex(entry.dates)}}`,
    `      {${markupToLatex(entry.role)}}{${markupToLatex(entry.location)}}`,
    ...bulletList(entry.bullets, '      '),
    '',
  ]);
  return [
    tex`\section{Experience}`,
    tex`  \resumeSubHeadingListStart`,
    '',
    ...body,
    tex`  \resumeSubHeadingListEnd`,
    tex`\vspace{-12pt}`,
    '',
  ];
}

// {\textbf{name} $|$ \emph{stack} \, link}{dates} — the stack and the link are
// both optional, so a project with neither still renders a clean heading.
function projectHeading(project: Project): string {
  const parts = [tex`\textbf{${markupToLatex(project.name)}}`];
  if (project.tech) parts.push(tex`\emph{${markupToLatex(project.tech)}}`);
  const link = project.link ? tex` \, ${latexLink(project.link.label, project.link.url)}` : '';
  return `{${parts.join(tex` $|$ `)}${link}}{${markupToLatex(project.dates)}}`;
}

function projectsSection(entries: Project[]): string[] {
  if (!entries.length) return [];
  const body = entries.flatMap((project) => [
    tex`    \resumeProjectHeading`,
    `      ${projectHeading(project)}`,
    ...bulletList(project.bullets, '      '),
    '',
  ]);
  return [
    tex`\section{Projects}`,
    tex`  \resumeSubHeadingListStart`,
    '',
    ...body,
    tex`  \resumeSubHeadingListEnd`,
    tex`\vspace{-12pt}`,
    '',
  ];
}

function skillsSection(groups: SkillGroup[]): string[] {
  if (!groups.length) return [];
  const lines = groups.map((group, i) => {
    const items = group.items.map(markupToLatex).join(', ');
    const brk = i < groups.length - 1 ? tex` \\` : '';
    return `     \\textbf{${markupToLatex(group.label)}}{: ${items}}${brk}`;
  });
  return [
    tex`\section{Technical Skills}`,
    tex` \begin{itemize}[leftmargin=0.15in, label={}]`,
    tex`    \small{\item{`,
    ...lines,
    tex`    }}`,
    tex` \end{itemize}`,
    tex` \vspace{-12pt}`,
    '',
  ];
}

function educationSection(entries: Education[]): string[] {
  if (!entries.length) return [];
  const body = entries.flatMap((entry) => [
    tex`    \resumeSubheading`,
    `      {${markupToLatex(entry.school)}}{${markupToLatex(entry.dates)}}`,
    `      {${markupToLatex(entry.degree)}}{${markupToLatex(entry.location)}}`,
  ]);
  return [
    tex`\section{Education}`,
    tex`  \resumeSubHeadingListStart`,
    ...body,
    tex`  \resumeSubHeadingListEnd`,
    '',
  ];
}

/** A résumé document as compilable LaTeX. */
export function renderResume(resume: Resume): string {
  return [
    PREAMBLE,
    tex`\begin{document}`,
    '',
    ...header(resume),
    ...experienceSection(resume.experience),
    ...projectsSection(resume.projects),
    ...skillsSection(resume.skills),
    ...educationSection(resume.education),
    tex`\end{document}`,
    '',
  ].join('\n');
}
