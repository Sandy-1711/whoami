// `resume score` — the free, deterministic JD fit check. Same scorer the paid
// tailor pipeline uses (extractJdKeywords → classify → scoreResume), unbundled:
// no LLM, no PDF render, no network. Prints the before/after ATS score and the
// three keyword buckets so you can decide whether a role is worth a full
// (paid) tailor run — or hand the addable list to whoever edits the résumé.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extractJdKeywords, classify, scoreResume, latexToPlainText, type Facts,
} from '@resume/core';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

export interface RunScoreArgs {
  jd: string;
}

export async function runScore(cli: Cli, args: RunScoreArgs): Promise<void> {
  const jd = (args.jd || '').trim();
  if (!jd || jd.length < 20) {
    throw new Error('JD text looks too short to analyze — pass a file path or --jd "text…".');
  }

  console.log(ui.banner('JD score', 'deterministic keyword match — no LLM, no cost'));

  const facts: Facts = JSON.parse(await readFile(join(cli.root, 'profile', 'facts.json'), 'utf8'));
  const resumeText = latexToPlainText(await readFile(join(cli.root, 'resume.tex'), 'utf8'));

  const jdKeywords = extractJdKeywords(jd);
  const cls = classify(jdKeywords, resumeText, facts);
  const score = scoreResume(cls);

  console.log(ui.scoreTable(score.before, score.after));
  console.log('');
  console.log(ui.heading(`Matched — already on the résumé (${cls.matched.length})`));
  console.log(ui.chips(cls.matched, 'good'));
  console.log(ui.heading(`Addable — TRUE facts to surface (${cls.addable.length})`));
  console.log(ui.chips(cls.addable, 'add'));
  console.log(ui.heading(`Missing — do NOT claim these (${cls.missing.length})`));
  console.log(ui.chips(cls.missing, 'bad'));
  console.log('');
  console.log(pc.dim(`  ${score.total} JD keywords recognized. Score = 20 structure + 80 × coverage.`));
}
