import { describe, expect, it } from 'vitest';
import { renderResume } from './render.js';
import { parseResume } from './schema.js';

const RESUME = parseResume({
  name: 'Sandeep Singh',
  subtitle: ['AI Engineer', 'Agent Infrastructure & LLM Systems'],
  contacts: ['[x@y.dev](mailto:x@y.dev)', '+91 8953596712'],
  summary: '**AI Engineer** building agentic LLM systems.',
  experience: [
    {
      id: 'acme',
      org: 'Acme AI',
      role: 'AI Engineer',
      dates: 'Nov 2025 - March 2026',
      location: 'Bangalore, India',
      bullets: [{ id: 'acme-1', text: 'Cut token usage by **82%**.' }],
    },
  ],
  projects: [
    {
      id: 'voice-sdk',
      name: 'voice-sdk',
      tech: 'TypeScript, WebSockets',
      dates: '2026',
      link: { label: 'GitHub', url: 'https://github.com/Sandy-1711/voice-sdk' },
      bullets: [{ id: 'voice-sdk-1', text: 'One interface for **TTS** and **STT**.' }],
    },
    { id: 'bare', name: 'bare', dates: '2025', bullets: [{ id: 'bare-1', text: 'Shipped it.' }] },
  ],
  skills: [
    { id: 'ai-ml', label: 'AI/ML & LLM', items: ['RAG', 'Mastra'] },
    { id: 'languages', label: 'Languages', items: ['TypeScript'] },
  ],
  education: [
    { id: 'mmmut', school: 'MMMUT', degree: 'B.Tech', dates: 'Nov 2022 – Aug 2026', location: 'Gorakhpur, India' },
  ],
});

const tex = renderResume(RESUME);

describe('renderResume', () => {
  it('produces a complete document around the preamble', () => {
    expect(tex.startsWith('\\documentclass')).toBe(true);
    expect(tex).toContain('\\newcommand{\\resumeSubheading}[4]');
    expect(tex.endsWith('\\end{document}\n')).toBe(true);
  });

  it('joins the subtitle and the contacts the way the header expects', () => {
    expect(tex).toContain('{\\large AI Engineer $|$ Agent Infrastructure \\& LLM Systems} \\\\ \\vspace{4pt}');
    expect(tex).toContain('\\href{mailto:x@y.dev}{\\underline{x@y.dev}} \\,$\\bullet$\\,');
    expect(tex).toContain('    +91 8953596712\n');
  });

  it('writes each experience entry as a subheading plus its bullets', () => {
    expect(tex).toContain('    \\resumeSubheading\n      {Acme AI}{Nov 2025 - March 2026}\n'
      + '      {AI Engineer}{Bangalore, India}\n      \\resumeItemListStart\n'
      + '        \\resumeItem{Cut token usage by \\textbf{82\\%}.}\n      \\resumeItemListEnd');
  });

  it('shows a project stack and link only when it has them', () => {
    expect(tex).toContain('{\\textbf{voice-sdk} $|$ \\emph{TypeScript, WebSockets}'
      + ' \\, \\href{https://github.com/Sandy-1711/voice-sdk}{\\underline{GitHub}}}{2026}');
    expect(tex).toContain('{\\textbf{bare}}{2025}');
  });

  it('breaks between skill groups but not after the last', () => {
    expect(tex).toContain('\\textbf{AI/ML \\& LLM}{: RAG, Mastra} \\\\\n');
    expect(tex).toContain('\\textbf{Languages}{: TypeScript}\n');
  });

  // An itemize with no \item does not compile, so an empty section is dropped
  // and the source guard reports it missing.
  it('drops a section with no entries', () => {
    const bare = renderResume(parseResume({ ...RESUME, projects: [], skills: [], education: [] }));
    expect(bare).toContain('\\section{Experience}');
    expect(bare).not.toContain('\\section{Projects}');
    expect(bare).not.toContain('\\begin{itemize}[leftmargin=0.15in');
  });
});
