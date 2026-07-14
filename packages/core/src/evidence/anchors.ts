// Anchor mapping (architecture Layer 6 → 7 bridge).
//
// The coverage selector picks evidence units globally, but the résumé has fixed
// entries — each a TAILOR bullet-group anchor (see resume.tex / C25). This maps a
// unit to the anchor whose entry it describes, via its provenance, so the grounded
// writer can regenerate each entry's bullets from the units that belong to it.
// Units matching no anchor (repos/LinkedIn prose with no résumé slot) are left
// out of the rendered bullets — they still live in the store for future entries.
import type { EvidenceUnit } from './store.js';

export interface AnchorSpec {
  anchor: string;     // the resume.tex TAILOR anchor name
  label: string;      // section label handed to the writer
  maxBullets: number; // default per-entry bullet budget
  match: (unit: EvidenceUnit) => boolean;
}

// True when any of a unit's provenance refs matches the pattern.
const refMatches = (unit: EvidenceUnit, re: RegExp): boolean =>
  unit.provenance.some((p) => re.test(p.ref));

// Ordered — a unit is assigned to the FIRST anchor it matches, so experience wins
// over an incidental open-source mention in the same merged unit.
export const RESUME_ANCHORS: AnchorSpec[] = [
  { anchor: 'exp-aira', label: 'Experience: AiRA (AI Engineer)', maxBullets: 5, match: (u) => refMatches(u, /aira/i) },
  { anchor: 'exp-iitkgp', label: 'Experience: IIT Kharagpur (Research Intern)', maxBullets: 3, match: (u) => refMatches(u, /kharagpur|iit/i) },
  { anchor: 'proj-samagra', label: 'Project: Samagra (Founding Software Engineer)', maxBullets: 3, match: (u) => refMatches(u, /samagra/i) },
  {
    anchor: 'proj-oss', label: 'Project: Open Source (Mastra, cal.com, n8n)', maxBullets: 3,
    match: (u) => u.provenance.some((p) => p.source === 'contribution') || refMatches(u, /open source|mastra|cal\.com|n8n/i),
  },
];

// Assign each unit to the first anchor it matches. Returns a map anchor → units,
// preserving input order (already quality/tier-sorted by curatedUnits).
export function groupUnitsByAnchor(
  units: EvidenceUnit[],
  anchors: AnchorSpec[] = RESUME_ANCHORS,
): Map<string, EvidenceUnit[]> {
  const groups = new Map<string, EvidenceUnit[]>(anchors.map((a) => [a.anchor, []]));
  for (const unit of units) {
    const spec = anchors.find((a) => a.match(unit));
    if (spec) groups.get(spec.anchor)!.push(unit);
  }
  return groups;
}

// Units that matched no anchor — useful for reporting coverage the résumé can't
// currently place.
export function unanchoredUnits(units: EvidenceUnit[], anchors: AnchorSpec[] = RESUME_ANCHORS): EvidenceUnit[] {
  return units.filter((u) => !anchors.some((a) => a.match(u)));
}
