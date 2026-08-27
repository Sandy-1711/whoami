// A tool that writes a file names it in its result, and the transcript dropped
// the whole payload — so a PDF that cost credits and a minute of LaTeX was
// unreachable from the message announcing it.
//
// This picks out the files the browser can actually open. Only tailored PDFs
// qualify: `GET /api/outputs/*` serves that directory and nothing else, and the
// canonical résumé already has a permanent home in the preview pane.
//
// Values are matched by shape rather than by tool name and key, so a tool added
// later that files something under tailored/ is surfaced without being listed
// here.
import type { Artifact } from '../shared/events.js';

const TAILORED_PDF = /^tailored\/[^\0]+\.pdf$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// tailor_render reports the score it started from and the one it measured on the
// document that rendered. Both or neither — a half-read score is worse than none.
function readScore(value: unknown): Artifact['score'] {
  if (!isRecord(value)) return undefined;
  const { current, tailored } = value;
  if (typeof current !== 'number' || typeof tailored !== 'number') return undefined;
  return { before: current, after: tailored };
}

/**
 * The openable files one tool result names, in the order they appear.
 *
 * Paths come out of a tool relative to the repo root and leave here relative to
 * `tailored/`, which is how the outputs route and its listing both spell them.
 * Previewing a card and picking the same file from the pane's list must be one
 * value, or the pane is asked for something that does not resolve.
 */
export function artifactsFrom(tool: string, result: unknown): Artifact[] {
  if (!isRecord(result)) return [];

  const paths = [...new Set(
    Object.values(result)
      .filter((v): v is string => typeof v === 'string' && TAILORED_PDF.test(v))
      .map((path) => path.slice('tailored/'.length)),
  )];
  if (paths.length === 0) return [];

  const score = readScore(result.score);
  const guardsPass = typeof result.guardsPass === 'boolean' ? result.guardsPass : undefined;

  return paths.map((relPath) => ({ relPath, tool, score, guardsPass }));
}
