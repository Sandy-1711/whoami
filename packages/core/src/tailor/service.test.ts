import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeLlm, type FakeLlm } from '@resume/llm/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { silentPresenter } from '../ports/logger.js';
import { recordScrape } from '../profile/sources.js';
import { SourceRefresher } from '../scrape/refresh.js';
import { fakeLatexCompiler, fakePdfInspector, overfullLog } from '../testing/index.js';
import { TailorService, type TailorRunContext } from './service.js';

const FACTS = {
  identity: { name: 'Sandeep Singh', github: 'https://github.com/Sandy-1711' },
  title_variants: ['AI Engineer'],
  allowed_keywords: ['RAG', 'FastAPI', 'TypeScript'],
  skills: { AI: ['RAG', 'FastAPI'], Languages: ['TypeScript'] },
  headline_metrics: ['16 merged PRs into Mastra', '10,000+ users'],
  experience: [{ company: 'AiRA', role: 'AI Engineer', bullets: ['Shipped RAG agents on FastAPI.'] }],
  projects: [{ name: 'Mastra', bullets: ['16 merged PRs into the agent runtime.'] }],
};

const RESUME = {
  name: 'Sandeep Singh',
  subtitle: ['AI Engineer', 'Agent Infrastructure', 'Full-Stack Engineer'],
  contacts: ['[sandy@example.dev](mailto:sandy@example.dev)'],
  summary: '**AI Engineer** building agentic LLM systems.',
  experience: [{
    id: 'aira', org: 'AiRA', role: 'AI Engineer', dates: 'Nov 2025 - March 2026', location: 'Remote',
    bullets: [{ id: 'aira-1', text: 'Shipped RAG agents on FastAPI.' }],
  }],
  projects: [{
    id: 'mastra', name: 'Mastra', tech: 'TypeScript', dates: '2025',
    bullets: [{ id: 'mastra-1', text: '16 merged PRs into the agent runtime.' }],
  }],
  skills: [{ id: 'ai', label: 'AI', items: ['RAG', 'FastAPI'] }],
  education: [{ id: 'mmmut', school: 'MMMUT', degree: 'B.Tech', dates: '2022 – 2026', location: 'Gorakhpur' }],
};

const GITHUB = {
  _comment: 'test fixture',
  scrapedAt: new Date().toISOString(),
  username: 'Sandy-1711',
  profileUrl: 'https://github.com/Sandy-1711',
  totals: { publicRepos: 1, totalStars: 36, mergedPRs: 16, externalRepos: 1 },
  repos: [{
    name: 'agent-runtime', description: 'RAG agents on FastAPI', url: 'https://github.com/Sandy-1711/agent-runtime',
    homepage: '', stars: 36, language: 'TypeScript', topics: ['rag'], archived: false,
    pushedAt: new Date().toISOString(), fork: false, readmeSize: 4096,
  }],
  contributions: [{
    repo: 'mastra-ai/mastra', url: 'https://github.com/mastra-ai/mastra',
    merged: 16, open: 0, closedUnmerged: 0, stars: 27000, samplePRs: [],
  }],
};

const JD = [
  'We are hiring an AI Dev Engineer to build RAG agents with FastAPI and TypeScript.',
  'Remote. Kubernetes experience a plus.',
].join('\n');

const DRAFT = {
  role_title: 'AI Dev Engineer',
  summary: 'AI Engineer shipping **RAG** agents on FastAPI, with **16 merged PRs** into Mastra.',
  subtitle: ['AI Engineer', 'RAG Systems', 'TypeScript'],
  bullets: [{ id: 'aira-1', text: 'Shipped **RAG** agents on **FastAPI**, in production.' }],
  rationale: 'Leads with the RAG and FastAPI overlap.',
};

const TIGHTER = {
  ...DRAFT,
  summary: 'AI Engineer shipping **RAG** agents on FastAPI.',
  rationale: 'Cut to fit one page.',
};

const roots: string[] = [];

// A root the refresher will leave alone: github.json already on disk with a
// just-recorded scrape, so it reports "fresh" instead of reaching the network.
// LinkedIn is gated behind liveLinkedin and skips itself.
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tailor-'));
  roots.push(root);
  await mkdir(join(root, 'profile'), { recursive: true });
  await writeFile(join(root, 'profile', 'facts.json'), JSON.stringify(FACTS));
  await writeFile(join(root, 'profile', 'github.json'), JSON.stringify(GITHUB));
  await recordScrape(root, 'github', 'cached-hash');
  await writeFile(join(root, 'profile', 'resume.json'), JSON.stringify(RESUME));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

function context(llm: FakeLlm): TailorRunContext {
  return { llm, refresher: new SourceRefresher({ githubToken: '', linkedinCookie: '', ttlHours: 12 }) };
}

describe('TailorService.run', () => {
  it('tailors, renders, and reports without touching a model twice when the guards pass', async () => {
    const root = await makeRoot();
    const latex = fakeLatexCompiler();
    const pdf = fakePdfInspector({ pages: [1] });
    const llm = createFakeLlm({ responses: [DRAFT] });

    const result = await new TailorService({ root, latex, pdf, presenter: silentPresenter })
      .run({ jd: JD, company: 'Acme AI' }, context(llm));

    expect(llm.calls.map((c) => c.operation)).toEqual(['tailor']);
    expect(result.role).toBe('AI Dev Engineer');
    expect(result.guardsPass).toBe(true);
    expect(result.paths.slug).toBe('acme_ai');

    // The artifacts the user is told to open must actually be there.
    expect(existsSync(result.paths.pdf)).toBe(true);
    expect(existsSync(result.paths.tex)).toBe(true);
    const report = await readFile(result.paths.report, 'utf8');
    expect(report).toContain(DRAFT.summary);
    // Named gaps are the point of the report: they are what must not be claimed.
    expect(report).toContain('Kubernetes');

    // The model's copy reached the LaTeX that was compiled — summary, subtitle
    // and the bullet it chose to rewrite.
    expect(latex.compiled[0]).toContain('shipping \\textbf{RAG} agents on FastAPI');
    expect(latex.compiled[0]).toContain('AI Engineer $|$ RAG Systems $|$ TypeScript');
    expect(latex.compiled[0]).toContain('\\resumeItem{Shipped \\textbf{RAG} agents on \\textbf{FastAPI}, in production.}');
  });

  it('keeps the original bullet when the model claims something the facts do not back', async () => {
    const root = await makeRoot();
    const latex = fakeLatexCompiler();
    const invented = {
      ...DRAFT,
      bullets: [{ id: 'aira-1', text: 'Shipped agents on **Kubernetes** at **99.99%** uptime.' }],
    };
    const llm = createFakeLlm({ responses: [invented] });

    const result = await new TailorService({
      root, latex, pdf: fakePdfInspector({ pages: [1] }), presenter: silentPresenter,
    }).run({ jd: JD, company: 'Acme AI' }, context(llm));

    expect(latex.compiled[0]).toContain('\\resumeItem{Shipped RAG agents on FastAPI.}');
    expect(latex.compiled[0]).not.toContain('Kubernetes');
    expect(result.report.reverted).toEqual([{ id: 'aira-1', unbacked: ['Kubernetes', '99.99%'] }]);
    // The summary was clean, so the rest of the rewrite still landed.
    expect(result.report.summary).toBe(DRAFT.summary);
  });

  it('scores what rendered, and keeps the projection beside it', async () => {
    const root = await makeRoot();
    // A résumé that never says TypeScript, which the fact base has: the plan
    // projects the gain, and only the render can say whether it landed.
    const thin = { ...RESUME, projects: [{ ...RESUME.projects[0]!, tech: '' }] };
    await writeFile(join(root, 'profile', 'resume.json'), JSON.stringify(thin));
    // Copy that never works TypeScript in, so the projection is not reached.
    const llm = createFakeLlm({ responses: [{ ...DRAFT, subtitle: ['AI Engineer', 'RAG Systems'] }] });

    const result = await new TailorService({
      root, latex: fakeLatexCompiler(), pdf: fakePdfInspector({ pages: [1] }), presenter: silentPresenter,
    }).run({ jd: JD, company: 'Acme AI' }, context(llm));

    expect(result.score).toMatchObject({ before: 60, after: 60 });
    expect(result.report.projectedAfter).toBe(80);
    expect(await readFile(result.paths.report, 'utf8')).toContain('projected 80');
  });

  it('grounds the prompt in the JD and the fact base', async () => {
    const root = await makeRoot();
    const llm = createFakeLlm({ responses: [DRAFT] });

    await new TailorService({
      root, latex: fakeLatexCompiler(), pdf: fakePdfInspector(), presenter: silentPresenter,
    }).run({ jd: JD, company: 'Acme AI' }, context(llm));

    const prompt = llm.calls[0]!.prompt;
    expect(prompt).toContain('RAG agents with FastAPI');
    expect(prompt).toContain('16 merged PRs into Mastra');
  });

  it('asks for a tighter draft when the résumé overflows, and reports the draft that fit', async () => {
    const root = await makeRoot();
    const latex = fakeLatexCompiler();
    const pdf = fakePdfInspector({ pages: [2, 1] });
    const llm = createFakeLlm({ responses: [DRAFT, TIGHTER] });

    const result = await new TailorService({ root, latex, pdf, presenter: silentPresenter })
      .run({ jd: JD, company: 'Acme AI' }, context(llm));

    expect(llm.calls.map((c) => c.operation)).toEqual(['tailor', 'tailor-fix']);
    expect(llm.calls[1]!.prompt).toContain('overflowed to 2 pages');
    expect(result.guardsPass).toBe(true);
    // The report describes what finally rendered, not the draft that overflowed.
    expect(result.report.summary).toBe(TIGHTER.summary);
    expect(latex.compiled).toHaveLength(2);
  });

  it('treats a line running past the text width as a guard failure', async () => {
    const root = await makeRoot();
    const llm = createFakeLlm({ responses: [DRAFT] });

    const result = await new TailorService({
      root,
      latex: fakeLatexCompiler({ logs: [overfullLog()] }),
      pdf: fakePdfInspector({ pages: [1] }),
      presenter: silentPresenter,
    }).run({ jd: JD, company: 'Acme AI' }, context(llm));

    expect(result.guardsPass).toBe(false);
    expect(result.report.guards.width[0]).toContain('past the page width');
  });

  it('gives up after the fix budget and still returns a usable result', async () => {
    const root = await makeRoot();
    const llm = createFakeLlm({ responses: [DRAFT, TIGHTER] });

    const result = await new TailorService({
      root,
      latex: fakeLatexCompiler(),
      pdf: fakePdfInspector({ pages: [2] }),
      presenter: silentPresenter,
    }).run({ jd: JD, company: 'Acme AI' }, context(llm));

    expect(llm.calls.map((c) => c.operation)).toEqual(['tailor', 'tailor-fix', 'tailor-fix']);
    expect(result.guardsPass).toBe(false);
    expect(existsSync(result.paths.pdf)).toBe(true);
  });

  it('fails before spending a model call when nothing can render', async () => {
    const root = await makeRoot();
    const llm = createFakeLlm({ responses: [DRAFT] });

    await expect(
      new TailorService({
        root,
        latex: fakeLatexCompiler({ availability: 'docker-daemon-down' }),
        pdf: fakePdfInspector(),
        presenter: silentPresenter,
      }).run({ jd: JD, company: 'Acme AI' }, context(llm)),
    ).rejects.toThrow(/Docker daemon is down/);

    expect(llm.calls).toHaveLength(0);
  });

  it('surfaces a compile failure rather than reporting on a PDF that was never written', async () => {
    const root = await makeRoot();
    const llm = createFakeLlm({ responses: [DRAFT] });

    await expect(
      new TailorService({
        root,
        latex: fakeLatexCompiler({ failCompiles: [1] }),
        pdf: fakePdfInspector(),
        presenter: silentPresenter,
      }).run({ jd: JD, company: 'Acme AI' }, context(llm)),
    ).rejects.toThrow(/Compilation error/);
  });

  it('rejects a JD too short to analyze before doing any work', async () => {
    const root = await makeRoot();
    const llm = createFakeLlm({ responses: [DRAFT] });

    await expect(
      new TailorService({
        root, latex: fakeLatexCompiler(), pdf: fakePdfInspector(), presenter: silentPresenter,
      }).run({ jd: 'too short', company: 'Acme AI' }, context(llm)),
    ).rejects.toThrow(/too short/);

    expect(llm.calls).toHaveLength(0);
  });
});

describe('TailorService.plan and .render as separate calls', () => {
  it('plans without a LaTeX toolchain, and renders from the saved plan later', async () => {
    const root = await makeRoot();
    const pdf = fakePdfInspector({ pages: [1] });
    const llm = createFakeLlm({ responses: [DRAFT] });

    // Planning must survive a machine with no way to render — that is the whole
    // reason the stages are separate.
    const planner = new TailorService({
      root, latex: fakeLatexCompiler({ availability: 'docker-daemon-down' }), pdf, presenter: silentPresenter,
    });
    const { plan, planFile } = await planner.plan({ jd: JD, company: 'Acme AI' }, context(llm));

    expect(plan.role).toBe('AI Dev Engineer');
    expect(plan.edit.summary).toBe(DRAFT.summary);
    expect(existsSync(planFile)).toBe(true);

    // A separate service instance, as a second process would be.
    const renderer = new TailorService({ root, latex: fakeLatexCompiler(), pdf, presenter: silentPresenter });
    const loaded = await renderer.loadPlan('Acme AI');
    const result = await renderer.render(loaded, { llm });

    expect(result.guardsPass).toBe(true);
    expect(existsSync(result.paths.pdf)).toBe(true);
    expect(await readFile(result.paths.report, 'utf8')).toContain(DRAFT.summary);
    // One model call for the plan; the render needed none because it fit.
    expect(llm.calls.map((c) => c.operation)).toEqual(['tailor']);
  });

  it('says which step is missing when a company was never planned', async () => {
    const root = await makeRoot();
    const svc = new TailorService({
      root, latex: fakeLatexCompiler(), pdf: fakePdfInspector(), presenter: silentPresenter,
    });
    await expect(svc.loadPlan('Never Heard Of')).rejects.toThrow(/planning step first/);
  });
});
