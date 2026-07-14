// `resume ingest` — (re)build the canonical evidence store (profile/evidence.json)
// from the fact base + scraped GitHub/LinkedIn sources: seed verified facts, run
// the repo quality gate, extract atomic claims, and merge near-duplicates. Writes
// the file for the user to review, then commit. Needs a Gemini key (embeddings).
import { IngestService } from '@resume/core';
import * as ui from '../ui.js';
import { pc } from '../ui.js';
import type { Cli } from '../container.js';

export async function runIngest(cli: Cli, { force = false }: { force?: boolean } = {}): Promise<void> {
  console.log(ui.banner('Ingest Evidence', force ? 'rebuild evidence.json · force overwrite' : 'build the evidence store from your sources'));
  console.log();

  if (!cli.config.llm.keys.gemini) {
    console.log('\n' + ui.fail('Ingest needs a Gemini API key for embeddings — set GEMINI_API_KEY in .env.') + '\n');
    return;
  }

  const provider = cli.registry.resolve(cli.config);
  const service = new IngestService({ root: cli.root, presenter: cli.presenter });

  try {
    const r = await service.run({ force }, { provider, embedder: cli.embedder });
    console.log(ui.ok(`Gate: ${pc.green(String(r.reposKept))} repos kept, ${pc.dim(String(r.reposDropped))} dropped${r.reposBanned ? `, ${r.reposBanned} banned` : ''}.`));
    console.log(ui.ok(`Units: ${pc.dim(`${r.seedUnits} seeded + ${r.extractedUnits} extracted`)} → ${pc.green(String(r.mergedUnits))} after merging ${r.duplicatesMerged} duplicates.`));
    console.log('\n' + ui.info(pc.dim(`Review ${pc.bold(r.relPath)}, then commit it. Pin/ban repos in ${pc.bold('profile/curation.json')} and re-run.`)) + '\n');
  } catch (err) {
    const msg = (err as Error).message;
    console.log('\n' + ui.fail(msg));
    if (/force/i.test(msg)) console.log(ui.info(pc.dim('Re-run with --force to overwrite (this discards hand edits to evidence.json).')));
    console.log();
  }
}
