// Grounded bullet writer + groundedness check (architecture Layer 6).
//
// The writer prompt sees ONLY the selected evidence units, so bullets can only be
// built from real proof, and each bullet is tagged with the unit_id it came from.
// checkGroundedness then verifies deterministically that (a) every bullet cites a
// selected unit and (b) every number in the bullet appears verbatim in that unit
// — catching any invented or inflated metric the model slips in. A tailor run
// rejects a draft with violations rather than shipping ungrounded copy.
import type { LlmProvider } from '../ports/llm.js';
import { writerPrompt, WRITER_SCHEMA, type WriterResponse } from '../prompts.js';
import type { EvidenceUnit } from './store.js';

export interface DraftBullet {
  unit_id: string;
  text: string;
}

export interface WriteBulletsInput {
  section: string;
  units: EvidenceUnit[]; // the selected units for this section/group
  atsKeywords: string[];
  maxBullets: number;
  provider: LlmProvider;
}

// Draft bullets for a section from its selected units. Only shapes/cleans the
// model output; grounding is enforced separately by checkGroundedness.
export async function writeBullets(input: WriteBulletsInput): Promise<DraftBullet[]> {
  const { section, units, atsKeywords, maxBullets, provider } = input;
  if (!units.length) return [];
  const parsed = await provider.generateJson<WriterResponse>({
    prompt: writerPrompt({
      section,
      units: units.map((u) => ({ id: u.id, claim: u.claim, skills: u.skills, impact: u.impact })),
      atsKeywords,
      maxBullets,
    }),
    schema: WRITER_SCHEMA,
  });
  const bullets = Array.isArray(parsed?.bullets) ? parsed.bullets : [];
  return bullets
    .map((b) => ({ unit_id: String(b?.unit_id ?? '').trim(), text: String(b?.text ?? '').trim() }))
    .filter((b) => b.unit_id && b.text)
    .slice(0, maxBullets);
}

export interface GroundednessViolation {
  bullet: string;
  reason: string;
}

// Pull the numeric tokens from a string (12, 82%, 10,000+, 25k, 99.9%, 150k+).
function numbers(text: string): string[] {
  return [...text.matchAll(/\d[\d,.]*\s?[%kKmM+]*/g)].map((m) => m[0].replace(/\s+/g, '').trim());
}

// Normalize a numeric token for comparison: lowercase, strip separators/suffixes
// so "10,000" ⊇ "10000" and "25k" matches "25k".
function normNum(n: string): string {
  return n.toLowerCase().replace(/[,+]/g, '').replace(/%$/, '');
}

// Verify every bullet is grounded in a selected unit and invents no numbers.
// Returns the violations (empty = fully grounded).
export function checkGroundedness(bullets: DraftBullet[], units: EvidenceUnit[]): GroundednessViolation[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const violations: GroundednessViolation[] = [];

  for (const b of bullets) {
    const unit = byId.get(b.unit_id);
    if (!unit) {
      violations.push({ bullet: b.text, reason: `cites unit_id "${b.unit_id}" which is not in the selected set.` });
      continue;
    }
    // The source text a metric may legitimately come from.
    const source = [unit.claim, unit.impact?.value, unit.impact?.metric, unit.impact?.scope]
      .filter(Boolean)
      .join(' ');
    const sourceNums = new Set(numbers(source).map(normNum));
    for (const n of numbers(b.text)) {
      const norm = normNum(n);
      // Bare years and trivial single digits are not "metrics" worth gating.
      if (/^\d{4}$/.test(norm) || norm.length <= 1) continue;
      if (!sourceNums.has(norm)) {
        violations.push({ bullet: b.text, reason: `metric "${n}" is not present in unit ${unit.id}.` });
      }
    }
  }
  return violations;
}
