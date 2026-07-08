// Renders a tailor run's outcome: the on-screen ATS breakdown, plus the
// <base>.report.md written next to the PDF. Split out of the command so
// runTailor() reads as a straight pipeline and the wording lives in one place.
import { writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { root } from '../root.js';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Classification, Score, OutputPaths } from '../types.js';

export interface TailorReport {
  cls: Classification;
  score: Score;
  role: string;
  summaryText: string;
  subtitle: string;
  rationale: string;
  guards: { pages: number | null; width: string[] };
  paths: OutputPaths;
  guardsPass: boolean;
  model: string;
}

export async function writeTailorReport(
  { cls, score, role, summaryText, subtitle, rationale, guards, paths, guardsPass, model }: TailorReport,
): Promise<void> {
  const pdfRel = relative(root, paths.pdf).replace(/\\/g, '/');

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
  if (rationale) { L.push(ui.heading('Why (Gemini)')); L.push('  ' + pc.dim(rationale)); }

  L.push(ui.heading('Output'));
  L.push(ui.kv('company', pc.cyan(paths.slug)));
  L.push(ui.kv('pdf', pc.cyan(pdfRel)));
  L.push(ui.kv('pages', guards.pages === 1 ? ui.ok('1') : ui.fail(`${guards.pages} (must be 1)`)));
  L.push(ui.kv('width', guards.width.length === 0 ? ui.ok('no overflow') : ui.fail(guards.width.join('; '))));

  L.push('\n' + (guardsPass
    ? ui.ok(pc.green(`Done. Open "${pdfRel}" — ATS ${score.before} → ${score.after}.`))
    : ui.warn('Tailored PDF built but a guard failed — fix before sending.')));
  console.log(L.join('\n') + '\n');

  const md = [
    `# Tailored résumé report — ${paths.base}`,
    ``, `- ATS score: **${score.before} → ${score.after}** (target 92+)`,
    `- Role: ${role}`,
    `- Engine: gemini ${model}`,
    `- Pages: ${guards.pages} · Width: ${guards.width.length === 0 ? 'OK' : guards.width.join('; ')}`,
    ``, `## Matched (${cls.matched.length})`, cls.matched.join(', ') || '(none)',
    ``, `## Surface — true & relevant (${cls.addable.length})`, cls.addable.join(', ') || '(none)',
    ``, `## Gaps — do not fabricate (${cls.missing.length})`, cls.missing.join(', ') || '(none)',
    ``, `## Tailored summary`, summaryText,
    ``, `## Tailored subtitle`, subtitle,
    rationale ? `\n## Rationale\n${rationale}` : '',
  ].join('\n');
  await writeFile(paths.report, md + '\n');
}
