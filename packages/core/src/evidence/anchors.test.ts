import { describe, it, expect } from 'vitest';
import { groupUnitsByAnchor, unanchoredUnits, RESUME_ANCHORS } from './anchors.js';
import type { EvidenceUnit, EvidenceProvenance } from './store.js';

const unit = (id: string, provenance: EvidenceProvenance[]): EvidenceUnit => ({
  id, claim: id, skills: [], domains: [], provenance, quality_score: 0.5, tier: 'normal',
});

describe('groupUnitsByAnchor', () => {
  it('routes units to the anchor their provenance describes', () => {
    const units = [
      unit('a', [{ source: 'facts', ref: 'experience/AiRA' }]),
      unit('k', [{ source: 'facts', ref: 'experience/IIT Kharagpur' }]),
      unit('s', [{ source: 'facts', ref: 'projects/Samagra (Indigle)' }]),
      unit('o', [{ source: 'contribution', ref: 'mastra-ai/mastra' }]),
      unit('oss2', [{ source: 'facts', ref: 'projects/Open Source' }]),
    ];
    const g = groupUnitsByAnchor(units);
    expect(g.get('exp-aira')!.map((u) => u.id)).toEqual(['a']);
    expect(g.get('exp-iitkgp')!.map((u) => u.id)).toEqual(['k']);
    expect(g.get('proj-samagra')!.map((u) => u.id)).toEqual(['s']);
    expect(g.get('proj-oss')!.map((u) => u.id).sort()).toEqual(['o', 'oss2']);
  });

  it('assigns a merged unit to the first matching anchor (experience wins)', () => {
    const merged = unit('m', [{ source: 'contribution', ref: 'mastra-ai/mastra' }, { source: 'facts', ref: 'experience/AiRA' }]);
    const g = groupUnitsByAnchor([merged]);
    expect(g.get('exp-aira')!.map((u) => u.id)).toEqual(['m']);
    expect(g.get('proj-oss')).toEqual([]);
  });

  it('leaves unmatched units out of every group', () => {
    const units = [unit('repo', [{ source: 'github', ref: 'EmailPartner' }])];
    const g = groupUnitsByAnchor(units);
    expect([...g.values()].flat()).toEqual([]);
    expect(unanchoredUnits(units).map((u) => u.id)).toEqual(['repo']);
  });

  it('covers every anchor declared in resume.tex', () => {
    expect(RESUME_ANCHORS.map((a) => a.anchor)).toEqual(['exp-aira', 'exp-iitkgp', 'proj-samagra', 'proj-oss']);
  });
});
