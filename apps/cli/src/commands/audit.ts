// `resume audit <slug>` — replay a tailored build's lockfile and report whether
// it's still trustworthy: units still grounded, guards passed, and whether
// resume.tex/weights drifted since. Uses the PDF inspector for a live one-page
// re-check. No TeX toolchain needed.
import { auditBuild } from '@resume/core';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

export async function runAudit(cli: Cli, { slug }: { slug: string }): Promise<void> {
  console.log(ui.banner('Build Audit', `replay tailored/${slug || '<slug>'}/build.lock.json`));
  if (!slug) {
    console.log('\n' + ui.fail('Pass a company slug: resume audit <slug> (see tailored/ for names).') + '\n');
    return;
  }

  const r = await auditBuild({ root: cli.root, slug, pdf: cli.pdf });
  if (!r.found) {
    console.log('\n' + ui.fail(r.checks[0]?.detail || `No lockfile for "${slug}".`) + '\n');
    return;
  }

  console.log('');
  for (const c of r.checks) {
    const mark = c.pass ? ui.ok('') : c.critical ? ui.fail('') : ui.warn('');
    console.log(`  ${mark} ${pc.bold(c.name)} ${pc.dim('— ' + c.detail)}`);
  }
  console.log('\n' + (r.pass
    ? ui.ok(pc.green('Audit passed — this build is grounded and its guards held.'))
    : ui.fail('Audit failed — do not submit until the critical checks pass.')) + '\n');
}
