// `resume wellfound-profile` — the standing Wellfound profile, one document for
// every role. The pipeline lives in @resume/core; this wires config → provider →
// service and draws the result. The per-posting note is `resume note`.
import { relative } from 'node:path';
import { WellfoundService, WELLFOUND_BIO_MAX, type WellfoundProfileResult } from '@resume/core';
import { createLlm } from '@resume/llm';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

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
  const llm = createLlm(cli.config.llm, { provider, model });
  const engine = llm.describe();
  console.log(ui.banner('Wellfound Profile', `standing profile from your fact base · engine: ${engine.label} ${engine.modelId}`));

  const service = new WellfoundService({ root: cli.root, presenter: cli.presenter });
  const result = await service.profile({ target }, { llm });
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
