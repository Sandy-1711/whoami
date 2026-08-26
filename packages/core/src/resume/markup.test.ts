import { describe, expect, it } from 'vitest';
import { boldTerms, latexLink, markupToLatex, markupToPlainText } from './markup.js';

describe('markupToLatex', () => {
  it('escapes everything that is not a marker', () => {
    expect(markupToLatex('cut cost 30% & shipped #1')).toBe('cut cost 30\\% \\& shipped \\#1');
  });

  it('converts the three markers', () => {
    expect(markupToLatex('**82%** via `asyncio`, see [PR list](https://x.dev/p?q=1)')).toBe(
      '\\textbf{82\\%} via \\texttt{asyncio}, see \\href{https://x.dev/p?q=1}{\\underline{PR list}}',
    );
  });

  it('keeps a link label that is itself bracketed', () => {
    expect(markupToLatex('[[PR list]](https://x.dev)')).toBe(
      '\\href{https://x.dev}{\\underline{[PR list]}}',
    );
  });

  it('prints LaTeX that arrives in prose rather than obeying it', () => {
    expect(markupToLatex('\\textbf{hi}')).toBe('\\textbackslash{}textbf\\{hi\\}');
  });

  it('escapes the characters that break a link target', () => {
    expect(markupToLatex('[x](https://x.dev/a%20b#c)')).toBe(
      '\\href{https://x.dev/a\\%20b\\#c}{\\underline{x}}',
    );
  });

  it('spells punctuation pdflatex cannot set', () => {
    expect(markupToLatex('memory — RAG – “quoted” … done')).toBe(
      "memory --- RAG -- ``quoted'' ... done",
    );
  });

  // The quote spelling above is two backticks; a code span must not pair with one.
  it('does not read a converted quote as a code span', () => {
    expect(markupToLatex('“a” and “b”')).toBe("``a'' and ``b''");
  });
});

describe('latexLink', () => {
  it('underlines the label in the résumé house style', () => {
    expect(latexLink('R&D', 'https://x.dev')).toBe('\\href{https://x.dev}{\\underline{R\\&D}}');
  });
});

describe('markupToPlainText', () => {
  it('drops the markers and keeps the words', () => {
    expect(markupToPlainText('**82%** via `asyncio`, see [PR list](https://x.dev)')).toBe(
      '82% via asyncio, see PR list',
    );
  });
});

describe('boldTerms', () => {
  it('lists what a bullet bolds, in order', () => {
    expect(boldTerms('**16 merged PRs** into **Mastra**')).toEqual(['16 merged PRs', 'Mastra']);
  });
});
