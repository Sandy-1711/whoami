// Builds the <base>.report.md written next to a tailored PDF. Pure: it turns the
// run's structured result into markdown. The on-screen ATS breakdown (tables,
// chips, gauges) is the CLI's job — it renders the same TailorReportData however
// it likes, keeping presentation out of the domain.
import type { Classification, Score, OutputPaths } from '../types.js';

export interface TailorReportData {
  cls: Classification;
  score: Score;
  role: string;
  summaryText: string;
  subtitle: string;
  rationale: string;
  guards: { pages: number | null; width: string[] };
  paths: OutputPaths;
  guardsPass: boolean;
  provider: string;
  model: string;
}

export function buildReportMarkdown(r: TailorReportData): string {
  const { cls, score, role, summaryText, subtitle, rationale, guards, paths, provider, model } = r;
  return [
    `# Tailored résumé report — ${paths.base}`,
    ``, `- ATS score: **${score.before} → ${score.after}** (target 92+)`,
    `- Role: ${role}`,
    `- Engine: ${provider} ${model}`,
    `- Pages: ${guards.pages} · Width: ${guards.width.length === 0 ? 'OK' : guards.width.join('; ')}`,
    ``, `## Matched (${cls.matched.length})`, cls.matched.join(', ') || '(none)',
    ``, `## Surface — true & relevant (${cls.addable.length})`, cls.addable.join(', ') || '(none)',
    ``, `## Gaps — do not fabricate (${cls.missing.length})`, cls.missing.join(', ') || '(none)',
    ``, `## Tailored summary`, summaryText,
    ``, `## Tailored subtitle`, subtitle,
    rationale ? `\n## Rationale\n${rationale}` : '',
  ].join('\n') + '\n';
}
