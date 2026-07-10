// `resume wellfound` and `resume wellfound-profile` — the two Wellfound seams.
// The pipeline lives in @resume/core; these commands wire config → provider →
// service and draw the result. The note is per-JD; the profile is a single
// standing document (like LinkedIn), so they are separate commands.
import { relative } from 'node:path';
import {
  WellfoundService, WELLFOUND_BIO_MAX,
  type WellfoundMessageResult, type WellfoundProfileResult,
} from '@resume/core';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

// ---- per-JD application-box note --------------------------------------------

export interface RunWellfoundArgs {
  jd: string;
  company: string;
  role?: string;
  provider?: string;
  model?: string;
}

export async function runWellfound(
  cli: Cli,
  { jd, company, role = '', provider, model }: RunWellfoundArgs,
): Promise<void> {
  const llm = cli.registry.resolve(cli.config, { provider, model });
  console.log(ui.banner('Wellfound Note', `JD → application-box message · engine: ${llm.label} ${llm.model}`));

  const service = new WellfoundService({ root: cli.root, presenter: cli.presenter });
  const result = await service.message({ jd, company, role }, { provider: llm });
  renderMessage(cli, result);
}

function renderMessage(cli: Cli, r: WellfoundMessageResult): void {
  const { message, wordCount, rationale, cls, score, paths } = r;
  const rel = relative(cli.root, paths.file).replace(/\\/g, '/');

  const L: string[] = [];
  L.push(ui.heading(`Application-box note (${wordCount} words) — paste into "What interests you about this role?"`));
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
  L.push(ui.kv('note', pc.cyan(rel)));
  L.push('\n' + ui.ok(pc.green(`Done. Copy the note above, or open "${rel}".`)));
  L.push(pc.dim('  Wellfound has no API — paste the note in the box and apply.'));
  console.log(L.join('\n') + '\n');
}

// ---- standing profile (one for every role) ----------------------------------

export interface RunWellfoundProfileArgs {
  target?: string;
  provider?: string;
  model?: string;
}

export async function runWellfoundProfile(
  cli: Cli,
  { target = '', provider, model }: RunWellfoundProfileArgs,
): Promise<void> {
  const llm = cli.registry.resolve(cli.config, { provider, model });
  console.log(ui.banner('Wellfound Profile', `standing profile from your fact base · engine: ${llm.label} ${llm.model}`));

  const service = new WellfoundService({ root: cli.root, presenter: cli.presenter });
  const result = await service.profile({ target }, { provider: llm });
  renderProfile(cli, result);
}

function renderProfile(cli: Cli, r: WellfoundProfileResult): void {
  const { profile, rationale, path } = r;
  const rel = relative(cli.root, path).replace(/\\/g, '/');

  const bioLen = profile.bio.length;
  const bioTag = bioLen <= WELLFOUND_BIO_MAX ? ui.ok(`${bioLen}/${WELLFOUND_BIO_MAX}`) : ui.fail(`${bioLen}/${WELLFOUND_BIO_MAX}`);

  const L: string[] = [];
  L.push(ui.heading('Headline'));
  L.push('  ' + pc.cyan(profile.headline));
  L.push(ui.heading(`Bio  (${bioTag} chars)`));
  L.push(wrapIndent(profile.bio, 2, 88));
  L.push(ui.heading("What I'm looking for"));
  L.push('  ' + pc.italic(profile.lookingFor));
  if (profile.achievements.length) {
    L.push(ui.heading(`Achievements (${profile.achievements.length}) — paste as bullets`));
    for (const a of profile.achievements) L.push('  ' + pc.dim('• ') + a);
  }
  L.push(ui.heading(`Skills (${profile.skills.length}) — add as tags, most important first`));
  L.push(ui.chips(profile.skills, 'add'));
  if (profile.experience.length) {
    L.push(ui.heading(`Experience blurbs (${profile.experience.length}) — paste under each role`));
    for (const e of profile.experience) {
      L.push('  ' + pc.bold(e.label));
      L.push(wrapIndent(e.blurb, 4, 86));
    }
  }
  if (rationale) { L.push(ui.heading('Why these choices')); L.push('  ' + pc.dim(rationale)); }

  L.push(ui.heading('Output'));
  L.push(ui.kv('profile', pc.cyan(rel)));
  L.push('\n' + ui.ok(pc.green(`Done. This is your standing profile — open "${rel}" and paste it into Wellfound.`)));
  L.push(pc.dim('  Re-run anytime (it overwrites) — it improves as your fact base does.'));
  console.log(L.join('\n') + '\n');
}

// ---- rendering helpers ------------------------------------------------------

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

// Word-wrap and left-pad a paragraph for the plain report sections.
function wrapIndent(text: string, indent: number, width: number): string {
  const pad = ' '.repeat(indent);
  return wrap(text, width).map((l) => pad + l).join('\n');
}

// Greedy word-wrap to a column width; preserves blank lines between paragraphs.
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
