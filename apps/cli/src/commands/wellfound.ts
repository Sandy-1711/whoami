// `resume wellfound` — read a Wellfound JD, draft the application-box note, and
// (unless --message-only) a profile refresh. The pipeline lives in @resume/core;
// this command is the thin CLI seam: wire config → provider → service, then draw
// the note prominently so it can be copied straight into Wellfound.
import { relative } from 'node:path';
import { WellfoundService, type WellfoundRunResult } from '@resume/core';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

export interface RunWellfoundArgs {
  jd: string;
  company: string;
  role?: string;
  messageOnly?: boolean;
  provider?: string;
  model?: string;
}

export async function runWellfound(
  cli: Cli,
  { jd, company, role = '', messageOnly = false, provider, model }: RunWellfoundArgs,
): Promise<void> {
  const llm = cli.registry.resolve(cli.config, { provider, model });

  console.log(ui.banner('Wellfound Assistant', `JD → application note${messageOnly ? '' : ' + profile refresh'} · engine: ${llm.label} ${llm.model}`));

  const service = new WellfoundService({ root: cli.root, presenter: cli.presenter });
  const result = await service.run({ jd, company, role, messageOnly }, { provider: llm });
  render(cli, result);
}

function render(cli: Cli, r: WellfoundRunResult): void {
  const { message, wordCount, messageRationale, profile, profileRationale, cls, score, paths, wroteProfile } = r;
  const msgRel = relative(cli.root, paths.message).replace(/\\/g, '/');
  const profRel = relative(cli.root, paths.profile).replace(/\\/g, '/');

  const L: string[] = [];

  // The note, boxed so it's obvious what to copy.
  L.push(ui.heading(`Application-box note (${wordCount} words) — paste into "What interests you about this role?"`));
  L.push('');
  L.push(boxed(message));
  if (messageRationale) { L.push(ui.heading('Why this framing')); L.push('  ' + pc.dim(messageRationale)); }

  // How well the note's claims are backed by JD keyword coverage.
  L.push(ui.heading(`Grounding — JD keywords you can truthfully lean on (${cls.matched.length + cls.addable.length})`));
  L.push(ui.chips([...cls.matched, ...cls.addable], 'good'));
  if (cls.missing.length) {
    L.push(ui.heading(`Not claimed — JD wants, not in your fact base (${cls.missing.length})`));
    L.push(ui.chips(cls.missing, 'bad'));
  }
  L.push(ui.heading('Résumé ATS coverage for this JD'));
  L.push('  ' + ui.gauge('coverage', score.after));

  // Profile refresh.
  if (profile) {
    L.push(ui.heading('Wellfound profile refresh (paste manually — no API)'));
    L.push(ui.kv('headline', pc.cyan(profile.headline)));
    L.push(ui.kv('about', pc.italic(profile.about)));
    L.push(ui.kv('looking for', pc.italic(profile.lookingFor)));
    L.push(ui.kv('skills', profile.skills.join(', ')));
    if (profileRationale) L.push(ui.kv('why', pc.dim(profileRationale)));
  } else if (!wroteProfile) {
    L.push(ui.heading('Wellfound profile refresh'));
    L.push('  ' + pc.dim('(skipped)'));
  }

  L.push(ui.heading('Output'));
  L.push(ui.kv('company', pc.cyan(paths.slug)));
  L.push(ui.kv('note', pc.cyan(msgRel)));
  if (wroteProfile) L.push(ui.kv('profile', pc.cyan(profRel)));

  L.push('\n' + ui.ok(pc.green(`Done. Copy the note above, or open "${msgRel}".`)));
  L.push(pc.dim('  Reminder: Wellfound has no API — paste the note in the box and apply the profile edits by hand.'));
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
