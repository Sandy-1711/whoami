// Ingest orchestrator (architecture Layers 1-3, end to end).
//
// Turns the scraped sources + fact base into the canonical evidence store:
//   1. Seed high-trust units from facts.json highlights (no LLM).
//   2. Curation: drop banned repos, force-keep pinned repos, gate the rest.
//   3. Extract atomic claims from each kept repo, external contribution, and
//      LinkedIn surface (one LLM call per source, fail-soft per source).
//   4. Finalize extracted claims with provenance, recency, and a quality score.
//   5. Embed every claim and merge near-duplicates (cosine cluster + LLM merge).
//   6. Write profile/evidence.json for the user to review, then commit.
//
// The service is pure orchestration over injected ports (LlmProvider, Embedder,
// Presenter); the CLI/agent supply the concrete adapters.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmProvider } from '../ports/llm.js';
import type { Embedder } from '../ports/embedding.js';
import type { Presenter } from '../ports/logger.js';
import type { Facts, GithubData, GithubRepo, LinkedinData } from '../types.js';
import {
  makeEvidenceId, readCuration, readEvidence, writeEvidence,
  type EvidenceStore, type EvidenceUnit,
} from './store.js';
import { runQualityGate } from './gate.js';
import { buildSourceRecords, seedUnitsFromFacts, type SourceRecord } from './normalize.js';
import { extractUnits, type ExtractedUnit } from './extract.js';
import { embedClaims } from './embedding.js';
import { dedupeUnits } from './dedup.js';

// Default trust when a source has no gate score. Contributions (external merged
// PRs) are inherently strong; LinkedIn prose is softer than the fact base.
const CONTRIBUTION_QUALITY = 0.85;
const LINKEDIN_QUALITY = 0.6;

export interface IngestRequest {
  // Overwrite an existing evidence.json even though it may hold hand-curated edits.
  force?: boolean;
}

export interface IngestResult {
  reposKept: number;
  reposDropped: number;
  reposBanned: number;
  sourcesExtracted: number;
  seedUnits: number;
  extractedUnits: number;
  mergedUnits: number; // final unit count after dedup
  duplicatesMerged: number;
  path: string;    // absolute path to evidence.json
  relPath: string;
}

export interface IngestServiceDeps {
  root: string;
  presenter: Presenter;
}

export interface IngestRunContext {
  provider: LlmProvider;
  embedder: Embedder;
  now?: Date;
}

export class IngestService {
  constructor(private readonly deps: IngestServiceDeps) {}

  async run(request: IngestRequest, ctx: IngestRunContext): Promise<IngestResult> {
    const { root, presenter } = this.deps;
    const { provider, embedder } = ctx;
    const now = ctx.now ?? new Date();

    // Guard hand-curated edits: refuse to clobber a non-empty store without force.
    const existing = await readEvidence(root);
    if (existing.units.length && !request.force) {
      throw new Error(
        `evidence.json already has ${existing.units.length} units — re-ingesting overwrites any hand edits. Re-run with force to proceed.`,
      );
    }

    const facts = await this.readJson<Facts>(join(root, 'profile', 'facts.json'));
    if (!facts) throw new Error('facts.json not found — cannot ingest without a fact base.');
    const github = await this.readJson<GithubData>(join(root, 'profile', 'github.json'));
    const linkedin = await this.readJson<LinkedinData>(join(root, 'profile', 'linkedin.json'));
    const curation = await readCuration(root);

    // Seeds — the verified fact base, highest trust, no LLM.
    const seeds = seedUnitsFromFacts(facts);

    // Curation-aware quality gate over the user's repos.
    const repos = github?.repos ?? [];
    const banned = repos.filter((r) => curation.repos[r.name] === 'banned');
    const pinned = repos.filter((r) => curation.repos[r.name] === 'pinned');
    const rest = repos.filter((r) => !curation.repos[r.name]);

    const gateSpin = presenter.spinner(`Quality-gating ${rest.length} repos…`);
    let keptRepos: GithubRepo[] = [];
    const quality = new Map<string, number>();
    try {
      const gate = await runQualityGate(rest, provider, now);
      keptRepos = [...pinned, ...gate.kept.map((k) => k.repo)];
      for (const k of gate.kept) quality.set(k.repo.name, k.quality);
      for (const p of pinned) quality.set(p.name, 1); // pinned = full trust
      gateSpin.succeed(`Gate: ${keptRepos.length} repos kept, ${gate.dropped.length + gate.rejected.length} dropped${banned.length ? `, ${banned.length} banned` : ''}.`);
    } catch (err) {
      gateSpin.fail(`Quality gate failed: ${(err as Error).message}`);
      throw err;
    }

    // Extraction — one call per source, fail-soft so one bad source is skipped.
    const records = buildSourceRecords({ keptRepos, contributions: github?.contributions ?? [], linkedin });
    const extracted: EvidenceUnit[] = [];
    let extractedFrom = 0;
    if (records.length) {
      const exSpin = presenter.spinner(`Extracting claims from ${records.length} sources…`);
      for (const record of records) {
        try {
          const units = await extractUnits(record, provider);
          for (const ex of units) extracted.push(this.finalize(ex, record, quality));
          if (units.length) extractedFrom++;
        } catch (err) {
          presenter.warn(`Skipped ${record.title}: ${(err as Error).message}`);
        }
      }
      exSpin.succeed(`Extracted ${extracted.length} claims from ${extractedFrom}/${records.length} sources.`);
    }

    // Merge exact-id duplicates (identical claims) before the costlier embedding
    // dedup, so seeds and extractions of the same sentence collapse for free.
    const all = dedupeById([...seeds, ...extracted]);

    // Embedding dedup — cluster near-duplicates and merge each cluster.
    const mergeSpin = presenter.spinner(`Embedding ${all.length} claims and merging duplicates…`);
    let merged: EvidenceUnit[];
    try {
      const vectors = await embedClaims(root, all.map((u) => u.claim), embedder);
      merged = await dedupeUnits({ units: all, vectors, provider });
      mergeSpin.succeed(`Merged to ${merged.length} units (${all.length - merged.length} duplicates folded in).`);
    } catch (err) {
      mergeSpin.fail(`Embedding/merge failed: ${(err as Error).message}`);
      throw err;
    }

    merged.sort((a, b) => b.quality_score - a.quality_score);
    const store: EvidenceStore = { units: merged };
    await writeEvidence(root, store);

    return {
      reposKept: keptRepos.length,
      reposDropped: rest.length - (keptRepos.length - pinned.length),
      reposBanned: banned.length,
      sourcesExtracted: extractedFrom,
      seedUnits: seeds.length,
      extractedUnits: extracted.length,
      mergedUnits: merged.length,
      duplicatesMerged: all.length - merged.length,
      path: join(root, 'profile', 'evidence.json'),
      relPath: 'profile/evidence.json',
    };
  }

  // Attach provenance/recency/quality/tier to an extracted claim.
  private finalize(ex: ExtractedUnit, record: SourceRecord, quality: Map<string, number>): EvidenceUnit {
    return {
      id: makeEvidenceId(ex.claim),
      claim: ex.claim,
      skills: ex.skills,
      domains: ex.domains,
      seniority_signal: ex.seniority_signal,
      impact: ex.impact,
      provenance: [{ source: record.source, ref: record.ref }],
      recency: record.recency,
      quality_score: qualityFor(record, quality),
      tier: 'normal',
    };
  }

  private async readJson<T>(path: string): Promise<T | null> {
    try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return null; }
  }
}

function qualityFor(record: SourceRecord, quality: Map<string, number>): number {
  if (record.source === 'github') return quality.get(record.ref) ?? 0.5;
  if (record.source === 'contribution') return CONTRIBUTION_QUALITY;
  if (record.source === 'linkedin') return LINKEDIN_QUALITY;
  return 0.7;
}

// Collapse units with the same id (identical claim), unioning provenance/skills/
// domains and keeping the strongest quality. Cheap pre-pass before embedding.
function dedupeById(units: EvidenceUnit[]): EvidenceUnit[] {
  const byId = new Map<string, EvidenceUnit>();
  for (const u of units) {
    const prev = byId.get(u.id);
    if (!prev) {
      byId.set(u.id, { ...u, skills: [...u.skills], domains: [...u.domains], provenance: [...u.provenance] });
      continue;
    }
    prev.skills = uniq([...prev.skills, ...u.skills]);
    prev.domains = uniq([...prev.domains, ...u.domains]);
    for (const p of u.provenance) {
      if (!prev.provenance.some((q) => q.source === p.source && q.ref === p.ref)) prev.provenance.push(p);
    }
    prev.quality_score = Math.max(prev.quality_score, u.quality_score);
    prev.impact = prev.impact ?? u.impact;
    prev.seniority_signal = prev.seniority_signal ?? u.seniority_signal;
    prev.recency = later(prev.recency, u.recency);
  }
  return [...byId.values()];
}

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const k = s.trim().toLowerCase();
    if (!s.trim() || seen.has(k)) continue;
    seen.add(k);
    out.push(s.trim());
  }
  return out;
}

function later(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}
