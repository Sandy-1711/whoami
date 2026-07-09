import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Load the compiled résumé PDF from disk. Tries the bundled asset first (next to
// this function at build time) and the runtime cwd second, so it works both
// locally and in the Vercel function bundle. Returns null when no PDF is present.
export function loadPdf(): Buffer | null {
  const candidates = [
    fileURLToPath(new URL('../assets/resume.pdf', import.meta.url)),
    join(process.cwd(), 'assets', 'resume.pdf'),
  ];

  for (const path of candidates) {
    try {
      if (existsSync(path)) return readFileSync(path);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}
