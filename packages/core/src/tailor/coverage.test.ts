import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoverageTailorService } from './coverage.js';
import { readBuildLock } from '../evidence/lockfile.js';
import { silentPresenter } from '../ports/logger.js';
import type { LlmProvider, LlmRequest } from '../ports/llm.js';
import type { Embedder } from '../ports/embedding.js';
import type { LatexCompiler, PdfInspector, CompileResult } from '../ports/latex.js';

const NOW = new Date('2026-07-14T00:00:00Z');

const RESUME = String.raw`\documentclass{article}
\begin{document}
\href{mailto:me@example.com}{me} linkedin github
\section{Experience}
%% >>>TAILOR:subtitle
{\large AI Engineer} \\ \vspace{4pt}
%% <<<TAILOR:subtitle
%% >>>TAILOR:summary
old summary
%% <<<TAILOR:summary
\resumeItemListStart
%% >>>TAILOR:exp-aira
\resumeItem{old aira bullet}
%% <<<TAILOR:exp-aira
\resumeItemListEnd
\resumeItemListStart
%% >>>TAILOR:exp-iitkgp
\resumeItem{old kgp bullet}
%% <<<TAILOR:exp-iitkgp
\resumeItemListEnd
\section{Projects}
\resumeItemListStart
%% >>>TAILOR:proj-samagra
\resumeItem{old samagra bullet}
%% <<<TAILOR:proj-samagra
\resumeItemListEnd
\resumeItemListStart
%% >>>TAILOR:proj-oss
\resumeItem{old oss bullet}
%% <<<TAILOR:proj-oss
\resumeItemListEnd
%% >>>TAILOR:skills
skills here
%% <<<TAILOR:skills
\section{Technical Skills}
\section{Education}
\end{document}`;

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cov-'));
  await mkdir(join(root, 'profile'), { recursive: true });
  await writeFile(join(root, 'resume.tex'), RESUME);
  await writeFile(join(root, 'profile', 'facts.json'), JSON.stringify({ identity: { name: 'Sandeep Singh' }, allowed_keywords: ['FastAPI'] }));
  await writeFile(join(root, 'profile', 'evidence.json'), JSON.stringify({
    units: [
      { id: 'ev_a', claim: 'Built the Daily Brief agent with FastAPI', skills: ['FastAPI'], domains: ['agents'], provenance: [{ source: 'facts', ref: 'experience/AiRA' }], quality_score: 1, tier: 'normal' },
      { id: 'ev_k', claim: 'Fine-tuned Qwen models to 75% accuracy', skills: ['LoRA'], domains: ['ml'], provenance: [{ source: 'facts', ref: 'experience/IIT Kharagpur' }], quality_score: 1, tier: 'normal' },
      { id: 'ev_s', claim: 'Scaled Samagra to 10,000+ users', skills: ['React Native'], domains: ['fullstack'], provenance: [{ source: 'facts', ref: 'projects/Samagra (Indigle)' }], quality_score: 1, tier: 'normal' },
      { id: 'ev_o', claim: 'Merged 12 PRs into Mastra agent runtime', skills: ['TypeScript'], domains: ['agents'], provenance: [{ source: 'contribution', ref: 'mastra-ai/mastra' }], quality_score: 0.9, tier: 'normal' },
    ],
  }));
  return root;
}

function provider(): LlmProvider {
  return {
    id: 'fake', label: 'Fake', model: 'm',
    async generateJson<T>(req: LlmRequest): Promise<T> {
      const p = req.prompt;
      if (p.includes('requirement graph')) {
        return { must_have: [{ req: 'build FastAPI agents', weight: 1 }], nice_to_have: [], ats_keywords: ['FastAPI'], seniority: 'mid', domain: 'AI agents' } as unknown as T;
      }
      if (p.includes('résumé bullets for the section')) {
        // Echo one grounded bullet per provided unit id (verbatim claim → passes groundedness).
        const ids = [...p.matchAll(/"id":"(ev_\w+)"/g)].map((m) => m[1]);
        const claims = [...p.matchAll(/"claim":"([^"]+)"/g)].map((m) => m[1]);
        return { bullets: ids.map((id, i) => ({ unit_id: id, text: claims[i] ?? 'x' })) } as unknown as T;
      }
      // tailor summary/subtitle
      return { role_title: 'AI Engineer', tailored_summary_text: 'Grounded summary.', tailored_subtitle: 'AI Engineer | Agents', bold_terms: [], rationale: 'r' } as unknown as T;
    },
  };
}

function embedder(): Embedder {
  let n = 0;
  return { id: 'e', label: 'E', model: 'fake-embed', async embed(texts) { return texts.map(() => [n++, 1, 0]); } };
}

// compile is synchronous in the port, so write the fake PDF + log synchronously
// where renderAndGuard expects them.
function latexSync(): LatexCompiler {
  return {
    availability: () => null,
    compile(root: string, texRel: string): CompileResult {
      writeFileSync(join(root, texRel.replace(/\.tex$/, '.pdf')), '%PDF-fake');
      writeFileSync(join(root, texRel.replace(/\.tex$/, '.log')), '');
      return { engine: 'docker', status: 0, output: '' };
    },
  };
}
const pdfInspector = (pages: number): PdfInspector => ({ async extract() { return { text: '', totalPages: pages }; } });

describe('CoverageTailorService', () => {
  it('selects evidence, writes grounded bullets, renders, and emits a lockfile', async () => {
    const root = await tmpRoot();
    const svc = new CoverageTailorService({ root, latex: latexSync(), pdf: pdfInspector(1), presenter: silentPresenter });
    const res = await svc.run({ jd: 'We need engineers to build FastAPI agents at scale.', company: 'Acme' }, { provider: provider(), embedder: embedder(), now: NOW });

    expect(res.guardsPass).toBe(true);
    expect(res.selectedCount).toBeGreaterThan(0);

    // Tailored .tex has the new bullets in each anchored entry.
    const tex = await readFile(res.paths.tex, 'utf8');
    expect(tex).toContain('Built the Daily Brief agent');
    expect(tex).toContain('Merged 12 PRs into Mastra');
    expect(tex).not.toContain('old aira bullet');

    // Lockfile records the requirement graph + selected units with anchors.
    const lock = await readBuildLock(res.lockPath);
    expect(lock!.requirement_graph.must_have[0].req).toBe('build FastAPI agents');
    expect(lock!.selected.some((u) => u.anchor === 'exp-aira')).toBe(true);
    expect(lock!.selected.some((u) => u.anchor === 'proj-oss')).toBe(true);
    expect(lock!.guards_pass).toBe(true);
  });

  it('shrinks bullets and still finishes when the page overflows', async () => {
    const root = await tmpRoot();
    const svc = new CoverageTailorService({ root, latex: latexSync(), pdf: pdfInspector(2), presenter: silentPresenter });
    const res = await svc.run({ jd: 'Build FastAPI agents and ship them.', company: 'Acme' }, { provider: provider(), embedder: embedder(), now: NOW });
    // Page never collapses to 1 in this fake, so guards fail but the run completes.
    expect(res.guardsPass).toBe(false);
    const lock = await readBuildLock(res.lockPath);
    expect(lock!.guards_pass).toBe(false);
  });

  it('throws when the evidence store is empty', async () => {
    const root = await tmpRoot();
    await writeFile(join(root, 'profile', 'evidence.json'), JSON.stringify({ units: [] }));
    const svc = new CoverageTailorService({ root, latex: latexSync(), pdf: pdfInspector(1), presenter: silentPresenter });
    await expect(svc.run({ jd: 'Build FastAPI agents here now.', company: 'Acme' }, { provider: provider(), embedder: embedder(), now: NOW }))
      .rejects.toThrow(/evidence store is empty/i);
  });
});
