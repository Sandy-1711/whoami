// One resolver for the job description every JD-taking tool needs. A JD arrives
// as pasted text, as a file the user saved, or as a posting URL; without this the
// caller has to paste the whole thing inline every time, which is what made the
// tools rigid.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

// Enough to be a job description rather than a stray line.
const MIN_JD_CHARS = 20;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_BYTES = 2_000_000;

// The three ways a JD can be supplied, as a Zod shape to spread into a tool's
// inputSchema so every tool documents them identically.
export const JD_INPUT_SHAPE = {
  jd: z.string().optional().describe('The full job description text, pasted inline.'),
  jdPath: z.string().optional().describe('Path to a file holding the JD (relative to the repo root, or absolute).'),
  jdUrl: z.string().optional().describe('URL of the job posting; the page is fetched and reduced to text.'),
};

export interface JdInput {
  jd?: string;
  jdPath?: string;
  jdUrl?: string;
}

/**
 * Resolve a job description from inline text, a file path, or a posting URL, in
 * that precedence. Throws when none is supplied or the result is too short to
 * analyze.
 */
export async function resolveJd(root: string, input: JdInput): Promise<string> {
  const jd = await resolveOptionalJd(root, input);
  if (!jd) throw new Error('No job description — pass `jd` (text), `jdPath` (a file), or `jdUrl` (the posting).');
  if (jd.trim().length < MIN_JD_CHARS) throw new Error('JD text looks too short to analyze.');
  return jd;
}

/**
 * As {@link resolveJd}, but returns '' when no JD was supplied — for tools where
 * the JD only sharpens the output instead of being the subject of it.
 */
export async function resolveOptionalJd(root: string, { jd, jdPath, jdUrl }: JdInput): Promise<string> {
  if (jd?.trim()) return jd.trim();
  if (jdPath?.trim()) return readJdFile(root, jdPath.trim());
  if (jdUrl?.trim()) return fetchJd(jdUrl.trim());
  return '';
}

async function readJdFile(root: string, path: string): Promise<string> {
  const full = resolve(root, path);
  try {
    return (await readFile(full, 'utf8')).trim();
  } catch {
    throw new Error(`Could not read the JD file: ${full}`);
  }
}

async function fetchJd(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs can be fetched — got ${parsed.protocol}`);
  }

  let res: Response;
  try {
    res = await fetch(parsed, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'text/html,text/plain' },
      redirect: 'follow',
    });
  } catch (err) {
    const reason = (err as Error)?.name === 'TimeoutError' ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s` : (err as Error).message;
    throw new Error(`Could not fetch ${parsed.href} — ${reason}. Save the JD to a file and pass \`jdPath\` instead.`);
  }
  if (!res.ok) throw new Error(`Fetching ${parsed.href} returned ${res.status} ${res.statusText}.`);

  const body = await readCapped(res);
  const text = htmlToText(body);
  if (text.length < MIN_JD_CHARS) {
    throw new Error(
      `${parsed.href} yielded almost no text — job boards that render client-side return an empty shell. ` +
      'Copy the JD out of the browser and pass `jd` or `jdPath`.',
    );
  }
  return text;
}

// Stop reading rather than truncating: a JD cut in half scores against keywords
// that were never really absent.
async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_FETCH_BYTES) throw new Error(`That page is ${declared} bytes — too large to be a job description.`);
  const body = await res.text();
  if (body.length > MAX_FETCH_BYTES) throw new Error(`That page is ${body.length} bytes — too large to be a job description.`);
  return body;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘',
};

// A deliberately small HTML reducer: drop the parts that are never prose, turn
// block boundaries into newlines, and strip what is left. Good enough to feed
// the keyword extractor, and never worth a DOM dependency.
export function htmlToText(html: string): string {
  if (!/<[a-z!/]/i.test(html)) return html.trim();
  return html
    .replace(/<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|ul|ol|table)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[String(name).toLowerCase()] ?? m)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n[ \n]*/g, '\n')
    .trim();
}
