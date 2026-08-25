import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveJd, resolveOptionalJd, htmlToText } from './inputs.js';

const JD = 'We are hiring an AI Engineer to build agent infrastructure with RAG and TypeScript.';

async function jdFile(name = 'jd.txt', body = JD): Promise<{ root: string; name: string }> {
  const root = await mkdtemp(join(tmpdir(), 'resume-jd-'));
  await writeFile(join(root, name), body);
  return { root, name };
}

function respondWith(body: string, init: ResponseInit = {}): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, ...init })));
}

afterEach(() => vi.unstubAllGlobals());

describe('resolveJd', () => {
  it('takes inline text', async () => {
    expect(await resolveJd('/nowhere', { jd: `  ${JD}  ` })).toBe(JD);
  });

  it('reads a path relative to the repo root', async () => {
    const { root, name } = await jdFile();
    expect(await resolveJd(root, { jdPath: name })).toBe(JD);
  });

  it('names the resolved path when the file is missing', async () => {
    const { root } = await jdFile();
    await expect(resolveJd(root, { jdPath: 'absent.txt' })).rejects.toThrow(/Could not read the JD file.*absent\.txt/s);
  });

  it('fetches a URL and reduces the page to text', async () => {
    respondWith(`<html><head><style>p{color:red}</style></head><body><h1>AI Engineer</h1><p>${JD}</p></body></html>`);
    const jd = await resolveJd('/nowhere', { jdUrl: 'https://jobs.example.com/ai-engineer' });
    expect(jd).toContain('AI Engineer');
    expect(jd).toContain('agent infrastructure');
    expect(jd).not.toContain('color:red');
  });

  it('refuses a non-http URL rather than reading the filesystem through it', async () => {
    await expect(resolveJd('/nowhere', { jdUrl: 'file:///etc/passwd' })).rejects.toThrow(/http\(s\)/);
  });

  it('reports the status when the posting does not resolve', async () => {
    respondWith('nope', { status: 404, statusText: 'Not Found' });
    await expect(resolveJd('/nowhere', { jdUrl: 'https://jobs.example.com/gone' })).rejects.toThrow(/404/);
  });

  it('points at jdPath when a page renders client-side and yields no text', async () => {
    respondWith('<html><body><div id="root"></div><script>render()</script></body></html>');
    await expect(resolveJd('/nowhere', { jdUrl: 'https://jobs.example.com/spa' })).rejects.toThrow(/jdPath/);
  });

  it('prefers inline text over a path or URL', async () => {
    const { root, name } = await jdFile('jd.txt', 'a different job description entirely, long enough to pass');
    expect(await resolveJd(root, { jd: JD, jdPath: name })).toBe(JD);
  });

  it('names all three inputs when none is supplied', async () => {
    await expect(resolveJd('/nowhere', {})).rejects.toThrow(/jd.*jdPath.*jdUrl/s);
  });

  it('rejects text too short to be a JD', async () => {
    await expect(resolveJd('/nowhere', { jd: 'too short' })).rejects.toThrow(/too short/i);
  });
});

describe('resolveOptionalJd', () => {
  it('returns empty when nothing was supplied', async () => {
    expect(await resolveOptionalJd('/nowhere', {})).toBe('');
  });
});

describe('htmlToText', () => {
  it('leaves plain text alone', () => {
    expect(htmlToText(JD)).toBe(JD);
  });

  it('turns list items into bullets and decodes entities', () => {
    expect(htmlToText('<ul><li>Python &amp; Go</li><li>RAG</li></ul>')).toBe('• Python & Go\n• RAG');
  });

  it('collapses the whitespace a stripped tag leaves behind', () => {
    expect(htmlToText('<p>One</p>\n\n   <p>Two</p>')).toBe('One\nTwo');
  });
});
