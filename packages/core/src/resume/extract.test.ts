import { describe, expect, it } from 'vitest';
import { extractResume } from './extract.js';
import { renderResume } from './render.js';
import { parseResume } from './schema.js';

// Ids are what the extractor derives from an entry's own name, so a document
// that round-trips must already carry those ids.
const RESUME = parseResume({
  name: 'Sandeep Singh',
  subtitle: ['AI Engineer', 'Agent Infrastructure & LLM Systems'],
  contacts: ['[x@y.dev](mailto:x@y.dev)', '[github.com/Sandy-1711](https://github.com/Sandy-1711)', '+91 8953596712'],
  summary: '**AI Engineer** building agentic LLM systems — **16 merged PRs** into Mastra.',
  experience: [
    {
      id: 'acme-ai',
      org: 'Acme AI',
      role: 'AI Engineer (Memory, RAG & Systems)',
      dates: 'Nov 2025 - March 2026',
      location: 'Bangalore, India',
      bullets: [
        { id: 'acme-ai-1', text: 'Cut routing-**LLM** token usage by **82%** via artifact-based prompting.' },
        { id: 'acme-ai-2', text: 'Stood up **promptfoo** evals across 8+ models.' },
      ],
    },
    {
      id: 'indigle',
      org: 'Indigle',
      role: 'Founding Software Engineer — Samagra [Play Store](https://play.google.com/store/apps/details?id=com.indigle.samagra)',
      dates: 'Sep 2024 - Sep 2025',
      location: 'India',
      bullets: [{ id: 'indigle-1', text: 'Grew a campus ERP to **10,000+ active users**.' }],
    },
  ],
  projects: [
    {
      id: 'open-source',
      name: 'Open Source',
      tech: 'TypeScript, Node.js',
      dates: '2025 - Present',
      bullets: [
        { id: 'open-source-1', text: '**16 into mastra-ai/mastra** [[PR list]](https://github.com/mastra-ai/mastra/pulls?q=author:Sandy-1711) across the runtime.' },
        { id: 'open-source-2', text: 'Webhook CSP security fix (`allow-same-origin`).' },
      ],
    },
    {
      id: 'voice-sdk',
      name: 'voice-sdk',
      tech: 'TypeScript, WebSockets, pnpm monorepo',
      dates: '2026',
      link: { label: 'GitHub', url: 'https://github.com/Sandy-1711/voice-sdk' },
      bullets: [{ id: 'voice-sdk-1', text: 'One interface across **Cartesia** and **Deepgram**.' }],
    },
  ],
  skills: [
    { id: 'ai-ml-llm', label: 'AI/ML & LLM', items: ['Hugging Face (PEFT/LoRA)', 'Mastra', 'RAG'] },
    { id: 'backend-ops', label: 'Backend & Ops', items: ['AWS (Lambda, S3)', 'FastAPI'] },
  ],
  education: [
    { id: 'mmmut', school: 'MMMUT', degree: 'B.Tech in ECE (CGPA: 7.32)', dates: 'Nov 2022 – Aug 2026', location: 'Gorakhpur, India' },
  ],
});

describe('extractResume', () => {
  it('reads back everything the renderer wrote', () => {
    expect(extractResume(renderResume(RESUME))).toEqual(RESUME);
  });

  it('survives the TAILOR comments the hand-written source carried', () => {
    const commented = renderResume(RESUME).replace(
      '\\section{Experience}',
      '%% >>>TAILOR:skills (a stale anchor)\n\\section{Experience}',
    );
    expect(extractResume(commented)).toEqual(RESUME);
  });

  it('refuses a source it cannot account for, rather than dropping content', () => {
    expect(() => extractResume('\\documentclass{article}')).toThrow(/document body/);
    expect(() => extractResume('\\begin{document}\\begin{center}\\end{center}\\end{document}')).toThrow(
      /name or subtitle/,
    );
  });
});
