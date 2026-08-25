// `resume note` — the short note an application form asks for in its free-text
// box, for whichever platform the posting is on. The pipeline lives in
// @resume/core; this wires config → provider → service and draws the result.
import {
  OutreachService, type ApplicationNoteResult, type CopyTone, type CopyLength,
} from '@resume/core';
import { createLlm } from '@resume/llm';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

export interface RunNoteArgs {
  jd: string;
  company: string;
  role?: string;
  platform?: string;
  tone?: CopyTone;
  length?: CopyLength;
  provider?: string;
  model?: string;
}

export async function runNote(
  cli: Cli,
  { jd, company, role = '', platform = '', tone, length, provider, model }: RunNoteArgs,
): Promise<void> {
  const llm = createLlm(cli.config.llm, { provider, model });
  const engine = llm.describe();
  const where = platform.trim() || 'application form';
  console.log(ui.banner('Application Note', `JD → ${where} box · engine: ${engine.label} ${engine.modelId}`));

  const service = new OutreachService({ root: cli.root, presenter: cli.presenter });
  const result = await service.note({ jd, company, role, platform, tone, length }, { llm });
  render(result);
}

function render(r: ApplicationNoteResult): void {
  const { message, wordCount, rationale, cls, score, paths, platform } = r;

  const L: string[] = [];
  L.push(ui.heading(`Note (${wordCount} words) — paste into "What interests you about this role?"`));
  L.push('');
  L.push(boxed(message));
  if (rationale) { L.push(ui.heading('Why this framing')); L.push('  ' + pc.dim(rationale)); }

  L.push(ui.heading(`Grounding — JD keywords you can truthfully lean on (${cls.matched.length + cls.addable.length})`));
  L.push(ui.chips([...cls.matched, ...cls.addable], 'good'));
  if (cls.missing.length) {
    L.push(ui.heading(`Not claimed — JD wants, not in your fact base (${cls.missing.length})`));
    L.push(ui.chips(cls.missing, 'bad'));
  }
  L.push(ui.heading('Résumé ATS coverage for this JD'));
  L.push('  ' + ui.gauge('coverage', score.after));

  L.push(ui.heading('Output'));
  L.push(ui.kv('company', pc.cyan(paths.slug)));
  if (platform) L.push(ui.kv('platform', pc.cyan(platform)));
  L.push(ui.kv('note', pc.cyan(paths.relPath)));
  L.push('\n' + ui.ok(pc.green(`Done. Copy the note above, or open "${paths.relPath}".`)));
  console.log(L.join('\n') + '\n');
}

// A cyan-bordered box around the note so it stands apart from the report chrome.
function boxed(text: string): string {
  const width = 76;
  const wrapped = text.split('\n').flatMap((para) => wrap(para, width));
  const border = pc.cyan;
  const top = border('  ┌' + '─'.repeat(width + 2) + '┐');
  const bottom = border('  └' + '─'.repeat(width + 2) + '┘');
  const body = wrapped.map((l) => border('  │ ') + l.padEnd(width) + border(' │'));
  return [top, ...body, bottom].join('\n');
}

// Greedy word-wrap to a column width.
function wrap(text: string, width: number): string[] {
  if (!text.trim()) return [''];
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line.length + 1 + word.length) > width) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}
