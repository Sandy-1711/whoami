// `resume tailor --coverage` — the evidence-based v2 pipeline. Resolves the
// provider + embedder, runs CoverageTailorService (requirement graph → coverage
// selection → grounded bullets → guarded render → lockfile), and prints a concise
// result. Requires an ingested evidence store and a Gemini key (embeddings).
import { relative } from 'node:path';
import { CoverageTailorService, SourceRefresher } from '@resume/core';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

export interface RunCoverageTailorArgs {
  jd: string;
  company: string;
  role?: string;
  provider?: string;
  model?: string;
}

export async function runCoverageTailor(
  cli: Cli,
  { jd, company, role = '', provider, model }: RunCoverageTailorArgs,
): Promise<void> {
  if (!cli.config.llm.keys.gemini) {
    console.log('\n' + ui.fail('Coverage tailoring needs a Gemini API key for embeddings — set GEMINI_API_KEY in .env.') + '\n');
    return;
  }
  const llm = cli.registry.resolve(cli.config, { provider, model });
  console.log(ui.banner('Résumé Tailor v2', `evidence coverage → grounded PDF · engine: ${llm.label} ${llm.model}`));

  const refresher = new SourceRefresher({
    githubToken: cli.config.githubToken,
    linkedinCookie: cli.config.linkedinCookie,
    ttlHours: cli.config.scrapeTtlHours,
    llm,
  });
  const service = new CoverageTailorService({ root: cli.root, latex: cli.latex, pdf: cli.pdf, presenter: cli.presenter });

  const r = await service.run({ jd, company, role }, { provider: llm, embedder: cli.embedder, refresher });
  const pdfRel = relative(cli.root, r.paths.pdf).replace(/\\/g, '/');
  const lockRel = relative(cli.root, r.lockPath).replace(/\\/g, '/');

  const L: string[] = [];
  L.push(ui.heading('Coverage build'));
  L.push(ui.kv('role', pc.cyan(r.role)));
  L.push(ui.kv('units selected', pc.cyan(String(r.selectedCount))));
  L.push(ui.kv('coverage score', pc.cyan(String(r.coverageScore))));
  L.push(ui.kv('ATS', `${r.score.before} → ${r.score.after}`));
  L.push(ui.kv('pdf', pc.cyan(pdfRel)));
  L.push(ui.kv('lockfile', pc.dim(lockRel)));
  L.push(ui.kv('pages', r.report.guards.pages === 1 ? ui.ok('1') : ui.fail(`${r.report.guards.pages} (must be 1)`)));
  L.push(ui.kv('width', r.report.guards.width.length === 0 ? ui.ok('no overflow') : ui.fail(r.report.guards.width.join('; '))));
  L.push('\n' + (r.guardsPass
    ? ui.ok(pc.green(`Done. Open "${pdfRel}" — grounded from ${r.selectedCount} evidence units.`))
    : ui.warn('Built but a guard failed even after shrinking — review before sending.')));
  console.log(L.join('\n') + '\n');
}
