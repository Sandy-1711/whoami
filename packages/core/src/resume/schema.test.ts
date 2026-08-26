import { describe, expect, it } from 'vitest';
import { parseResume, resumeBullets } from './schema.js';

const MINIMAL = {
  name: 'Sandeep Singh',
  subtitle: ['AI Engineer'],
  contacts: ['[mail](mailto:x@y.dev)'],
  summary: 'Builds agentic LLM systems.',
  experience: [
    { id: 'acme', org: 'Acme AI', role: 'Engineer', bullets: [{ id: 'acme-1', text: 'Shipped it.' }] },
  ],
};

describe('parseResume', () => {
  it('defaults the sections a résumé may omit', () => {
    const resume = parseResume(MINIMAL);
    expect(resume.projects).toEqual([]);
    expect(resume.experience[0]!.dates).toBe('');
  });

  it('rejects an id that is not kebab-case', () => {
    const bad = { ...MINIMAL, experience: [{ ...MINIMAL.experience[0]!, id: 'Acme AI' }] };
    expect(() => parseResume(bad)).toThrow(/kebab-case/);
  });

  it('rejects an id used twice, since an edit names a bullet by id alone', () => {
    const bad = {
      ...MINIMAL,
      experience: [{ ...MINIMAL.experience[0]!, bullets: [{ id: 'acme', text: 'Shipped it.' }] }],
    };
    expect(() => parseResume(bad)).toThrow(/duplicate id "acme"/);
  });

  it('names the field that does not fit', () => {
    expect(() => parseResume({ ...MINIMAL, summary: '' })).toThrow(/summary/);
  });
});

describe('resumeBullets', () => {
  it('pairs every bullet with the entry that owns it', () => {
    const resume = parseResume({
      ...MINIMAL,
      projects: [{ id: 'voice-sdk', name: 'voice-sdk', bullets: [{ id: 'voice-sdk-1', text: 'One interface.' }] }],
    });
    expect(resumeBullets(resume).map(({ entry, bullet }) => [entry.id, bullet.id])).toEqual([
      ['acme', 'acme-1'],
      ['voice-sdk', 'voice-sdk-1'],
    ]);
  });
});
