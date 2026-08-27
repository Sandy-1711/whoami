import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline } from './markdown';

describe('parseInline', () => {
  it('leaves prose with no markers as one run', () => {
    expect(parseInline('a plain sentence')).toEqual([{ kind: 'text', text: 'a plain sentence' }]);
  });

  it('reads bold, italics and inline code', () => {
    expect(parseInline('**b** and *i* and _j_ and `c`')).toEqual([
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', text: 'i' },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', text: 'j' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'c' },
    ]);
  });

  it('does not restyle the inside of a code span', () => {
    expect(parseInline('`**not bold**`')).toEqual([{ kind: 'code', text: '**not bold**' }]);
  });

  it('does not let the italic rule eat a bold pair', () => {
    expect(parseInline('**both stars**')).toEqual([{ kind: 'bold', text: 'both stars' }]);
  });

  it('leaves an unpaired marker literal, because the rest may still be arriving', () => {
    expect(parseInline('**half a bold')).toEqual([{ kind: 'text', text: '**half a bold' }]);
  });

  it('keeps snake_case identifiers out of the italic rule', () => {
    expect(parseInline('call tailor_render now')).toEqual([
      { kind: 'text', text: 'call tailor_render now' },
    ]);
  });

  it('reads a link', () => {
    expect(parseInline('see [the plan](https://example.com/p)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'the plan', href: 'https://example.com/p' },
    ]);
  });

  it('drops the href of a scheme the browser should not follow, keeping the label', () => {
    expect(parseInline('[click](javascript:alert)')).toEqual([{ kind: 'text', text: 'click' }]);
  });

  it('keeps a link to a path this server serves', () => {
    expect(parseInline('[pdf](/api/outputs/acme/resume.pdf)')).toEqual([
      { kind: 'link', text: 'pdf', href: '/api/outputs/acme/resume.pdf' },
    ]);
  });
});

describe('parseBlocks', () => {
  it('reads a heading by its level', () => {
    expect(parseBlocks('### Fit')).toEqual([{ kind: 'heading', level: 3, text: 'Fit' }]);
  });

  it('groups consecutive bullets into one list', () => {
    expect(parseBlocks('- one\n- two\n\nafter')).toEqual([
      { kind: 'list', ordered: false, items: ['one', 'two'] },
      { kind: 'paragraph', lines: ['after'] },
    ]);
  });

  it('tells a numbered list from a bulleted one', () => {
    expect(parseBlocks('1. first\n2) second')).toEqual([
      { kind: 'list', ordered: true, items: ['first', 'second'] },
    ]);
  });

  it('keeps a fenced block verbatim and records its language', () => {
    expect(parseBlocks('```sh\npnpm test\n**not bold**\n```')).toEqual([
      { kind: 'code', lang: 'sh', text: 'pnpm test\n**not bold**' },
    ]);
  });

  it('treats an unclosed fence as a code block, so a stream does not print backticks', () => {
    expect(parseBlocks('```ts\nconst a = 1;')).toEqual([
      { kind: 'code', lang: 'ts', text: 'const a = 1;' },
    ]);
  });

  it('grows the same block when the closing fence arrives', () => {
    const open = parseBlocks('```\nline one');
    const closed = parseBlocks('```\nline one\nline two\n```');
    expect(open[0]!.kind).toBe('code');
    expect(closed).toEqual([{ kind: 'code', lang: '', text: 'line one\nline two' }]);
  });

  it('does not read a list or heading inside a fence', () => {
    expect(parseBlocks('```\n- not a bullet\n# not a heading\n```')).toEqual([
      { kind: 'code', lang: '', text: '- not a bullet\n# not a heading' },
    ]);
  });

  it('keeps the line breaks the model wrote inside a paragraph', () => {
    expect(parseBlocks('one\ntwo')).toEqual([{ kind: 'paragraph', lines: ['one', 'two'] }]);
  });

  it('ends a paragraph where a block starts, with or without a blank line', () => {
    expect(parseBlocks('intro\n- a bullet')).toEqual([
      { kind: 'paragraph', lines: ['intro'] },
      { kind: 'list', ordered: false, items: ['a bullet'] },
    ]);
  });

  it('groups a quote', () => {
    expect(parseBlocks('> said\n> twice')).toEqual([{ kind: 'quote', lines: ['said', 'twice'] }]);
  });

  it('has nothing to draw for an empty answer', () => {
    expect(parseBlocks('')).toEqual([]);
  });
});
