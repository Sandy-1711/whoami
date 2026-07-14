// LLM extraction (architecture Layer 3, first half).
//
// One call per SourceRecord turns its raw text into atomic claims. The extractor
// only shapes + cleans the model's output; it assigns no id/tier/quality/
// provenance — the ingest orchestrator finalizes units against their source and
// the quality gate. Strict grounding lives in the prompt (extractPrompt); here we
// just drop empties and coerce the impact shape.
import type { LlmProvider } from '../ports/llm.js';
import { extractPrompt, EXTRACT_SCHEMA, type ExtractResponse } from '../prompts.js';
import type { EvidenceImpact } from './store.js';
import type { SourceRecord } from './normalize.js';

// A claim the extractor found, before ingest attaches provenance/scoring.
export interface ExtractedUnit {
  claim: string;
  skills: string[];
  domains: string[];
  seniority_signal?: string;
  impact?: EvidenceImpact;
}

// Extract claims from a single source. Throws only if the provider call itself
// fails (the orchestrator catches per-source so one bad source never sinks the
// whole ingest); an empty/garbled response yields [].
export async function extractUnits(record: SourceRecord, provider: LlmProvider): Promise<ExtractedUnit[]> {
  const parsed = await provider.generateJson<ExtractResponse>({
    prompt: extractPrompt(record),
    schema: EXTRACT_SCHEMA,
  });
  const units = Array.isArray(parsed?.units) ? parsed.units : [];
  const out: ExtractedUnit[] = [];
  for (const u of units) {
    const claim = String(u?.claim ?? '').trim();
    if (!claim) continue;
    out.push({
      claim,
      skills: cleanList(u.skills),
      domains: cleanList(u.domains),
      seniority_signal: u.seniority_signal?.trim() || undefined,
      impact: cleanImpact(u.impact),
    });
  }
  return out;
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    const s = String(x).trim();
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function cleanImpact(i: { metric?: string; value?: string; scope?: string } | undefined): EvidenceImpact | undefined {
  if (!i) return undefined;
  const metric = String(i.metric ?? '').trim();
  const value = String(i.value ?? '').trim();
  if (!metric && !value) return undefined;
  const scope = i.scope ? String(i.scope).trim() : undefined;
  return scope ? { metric, value, scope } : { metric, value };
}
