import { describe, expect, it } from 'vitest';
import { artifactsFrom } from './artifacts.js';

// What tailor_render actually returns, trimmed to the keys this reads.
const RENDER_RESULT = {
  company: 'katalyst_ai',
  role: 'AI Engineer',
  score: { current: 71, tailored: 92, projected: 88 },
  pdf: 'tailored/katalyst_ai/Sandeep Singh — AI Engineer.pdf',
  guardsPass: true,
  summary: 'Builds agent infrastructure…',
};

describe('artifactsFrom', () => {
  it('finds the PDF a render wrote, with the score measured on it', () => {
    expect(artifactsFrom('tailor_render', RENDER_RESULT)).toEqual([
      {
        relPath: 'katalyst_ai/Sandeep Singh — AI Engineer.pdf',
        tool: 'tailor_render',
        score: { before: 71, after: 92 },
        guardsPass: true,
      },
    ]);
  });

  it('drops the tailored/ prefix, so a card and the preview picker are one value', () => {
    const [artifact] = artifactsFrom('tailor_render', RENDER_RESULT);
    expect(artifact?.relPath.startsWith('tailored/')).toBe(false);
  });

  it('carries a failed guard through, since that file is not ship-ready', () => {
    const [artifact] = artifactsFrom('tailor_render', { ...RENDER_RESULT, guardsPass: false });
    expect(artifact?.guardsPass).toBe(false);
  });

  it('reports no score rather than half of one', () => {
    const [artifact] = artifactsFrom('tailor_render', {
      ...RENDER_RESULT,
      score: { current: 71, projected: 88 },
    });
    expect(artifact?.score).toBeUndefined();
  });

  it('ignores the canonical PDF, which has a permanent home in the preview pane', () => {
    expect(artifactsFrom('build_resume', { built: true, pdf: 'apps/web/assets/resume.pdf' }))
      .toEqual([]);
  });

  it('ignores a path outside tailored/, because nothing serves it', () => {
    expect(artifactsFrom('some_tool', { pdf: '../../etc/passwd.pdf' })).toEqual([]);
    expect(artifactsFrom('some_tool', { pdf: '/tmp/elsewhere.pdf' })).toEqual([]);
  });

  it('ignores a tailored file that is not a PDF', () => {
    expect(artifactsFrom('tailor_render', { report: 'tailored/acme/report.md' })).toEqual([]);
  });

  it('finds a path under any key, so a later tool needs no entry here', () => {
    expect(artifactsFrom('future_tool', { attachment: 'tailored/acme/one.pdf' })).toEqual([
      { relPath: 'acme/one.pdf', tool: 'future_tool', score: undefined, guardsPass: undefined },
    ]);
  });

  it('lists one card per file when a result names two', () => {
    const found = artifactsFrom('tailor_render', {
      pdf: 'tailored/acme/one.pdf',
      also: 'tailored/acme/two.pdf',
    });
    expect(found.map((a) => a.relPath)).toEqual(['acme/one.pdf', 'acme/two.pdf']);
  });

  it('does not repeat a file the result names twice', () => {
    const found = artifactsFrom('tailor_render', {
      pdf: 'tailored/acme/one.pdf',
      attachment: 'tailored/acme/one.pdf',
    });
    expect(found).toHaveLength(1);
  });

  it('has nothing to show for a cancelled run or a non-object result', () => {
    expect(artifactsFrom('tailor_render', { ran: false, reason: 'Cancelled.' })).toEqual([]);
    expect(artifactsFrom('tailor_render', 'a string')).toEqual([]);
    expect(artifactsFrom('tailor_render', null)).toEqual([]);
  });
});
