// `resume tailor` — resolve the provider, run the domain TailorService, and
// render the ATS report on screen. The pipeline itself lives in @resume/core;
// this command is the thin CLI seam: it wires config → provider → service and
// draws the result.
import { relative } from 'node:path';
import { createLlm } from '@resume/llm';
import {
  SourceRefresher, TailorService, type TailorReportData,
} from '@resume/core';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

export interface RunTailorArgs {
  jd: string;
  company: string;
  role?: string;
  provider?: string;
  model?: string;
}

export async function runTailor(
  cli: Cli,
  { jd, company, role = '', provider, model }: RunTailorArgs,
): Promise<void> {
  // Throws when the chosen provider has no key, before any work is done.
  const llm = createLlm(cli.config.llm, { provider, model });
  const engine = llm.describe();

  console.log(ui.banner('Résumé Tailor', `JD → ATS-optimized PDF · engine: ${engine.label} ${engine.modelId}`));

  const refresher = new SourceRefresher({
    githubToken: cli.config.githubToken,
    linkedinCookie: cli.config.linkedinCookie,
    ttlHours: cli.config.scrapeTtlHours,
    llm,
  });
  const service = new TailorService({
    root: cli.root,
    latex: cli.latex,
    pdf: cli.pdf,
    presenter: cli.presenter,
  });

  const result = await service.run({ jd, company, role }, { llm, refresher });
  renderReport(cli, result.report, engine.label);
}

// The on-screen ATS breakdown — the CLI's view of the run's structured result.
function renderReport(cli: Cli, r: TailorReportData, engineLabel: string): void {
  const { cls, score, role, summaryText, subtitle, rationale, guards, paths, guardsPass } = r;
  const pdfRel = relative(cli.root, paths.pdf).replace(/\\/g, '/');

  const L: string[] = [];
  L.push(ui.heading('ATS coverage'));
  L.push('\n' + ui.scoreTable(score.before, score.after));
  L.push('');
  L.push(ui.gauge('current', score.before));
  L.push(ui.gauge('tailored', score.after));

  L.push(ui.heading(`Matched — already in your résumé (${cls.matched.length})`));
  L.push(ui.chips(cls.matched, 'good'));
  L.push(ui.heading(`Surface these — TRUE & JD-relevant, add to lift the score (${cls.addable.length})`));
  L.push(ui.chips(cls.addable, 'add'));
  L.push(ui.heading(`Gaps — JD wants, not in your fact base (don't fake) (${cls.missing.length})`));
  L.push(ui.chips(cls.missing, 'bad'));

  L.push(ui.heading('Detected role'));
  L.push('  ' + pc.cyan(role));
  L.push(ui.heading('Tailored summary'));
  L.push('  ' + pc.italic(summaryText));
  L.push(ui.heading('Tailored subtitle'));
  L.push('  ' + pc.italic(subtitle));
  if (rationale) { L.push(ui.heading(`Why (${engineLabel})`)); L.push('  ' + pc.dim(rationale)); }

  L.push(ui.heading('Output'));
  L.push(ui.kv('company', pc.cyan(paths.slug)));
  L.push(ui.kv('pdf', pc.cyan(pdfRel)));
  L.push(ui.kv('pages', guards.pages === 1 ? ui.ok('1') : ui.fail(`${guards.pages} (must be 1)`)));
  L.push(ui.kv('width', guards.width.length === 0 ? ui.ok('no overflow') : ui.fail(guards.width.join('; '))));

  L.push('\n' + (guardsPass
    ? ui.ok(pc.green(`Done. Open "${pdfRel}" — ATS ${score.before} → ${score.after}.`))
    : ui.warn('Tailored PDF built but a guard failed — fix before sending.')));
  console.log(L.join('\n') + '\n');
}
