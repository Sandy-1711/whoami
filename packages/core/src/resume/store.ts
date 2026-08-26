// Where the résumé document lives, and how it reaches the compiler.
// profile/resume.json is the source of truth; resume.tex is what it renders to.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderResume } from './render.js';
import { parseResume, type Resume } from './schema.js';

export const RESUME_JSON = 'profile/resume.json';
export const RESUME_TEX = 'resume.tex';

/**
 * Read and validate the résumé document.
 * @throws Error naming the file when it is missing or does not parse.
 */
export async function loadResume(root: string): Promise<Resume> {
  let raw: string;
  try {
    raw = await readFile(join(root, RESUME_JSON), 'utf8');
  } catch {
    throw new Error(`No résumé document at ${RESUME_JSON} — the résumé is generated from it.`);
  }
  return parseResume(JSON.parse(raw));
}

/** Render the document to resume.tex, the artifact that compiles. */
export async function writeResumeTex(root: string, resume: Resume): Promise<string> {
  const tex = renderResume(resume);
  await writeFile(join(root, RESUME_TEX), tex);
  return tex;
}
