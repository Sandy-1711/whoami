// The activity log — every tool call this toolkit performs, appended to
// .agent/activity.jsonl (machine-local, gitignored). It is written for the
// sessions that come after: what was tailored for whom, which note went out,
// what failed and why. Nothing asks a model to remember to write it.
//
// JSONL rather than one JSON array: appends stay atomic-ish and a corrupt line
// costs one event instead of the whole history.
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ActivityEvent {
  ts: string;
  tool: string;
  ok: boolean;
  // Wall time of the call. Long ones are the MCP timeout risk, so they are
  // worth having on record.
  ms: number;
  company?: string;
  role?: string;
  // One line saying what happened, or the error when ok is false.
  detail?: string;
  artifacts?: string[];
}

export interface ActivityFilter {
  company?: string;
  tool?: string;
  limit?: number;
}

const file = (root: string): string => join(root, '.agent', 'activity.jsonl');
const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Append one event. Never throws: a failure to record must not fail the action
 * that was recorded.
 */
export async function recordActivity(root: string, event: ActivityEvent): Promise<void> {
  try {
    await mkdir(join(root, '.agent'), { recursive: true });
    await appendFile(file(root), JSON.stringify(event) + '\n');
  } catch { /* the log is a convenience, never a dependency */ }
}

/** Read events newest first, optionally narrowed to one company or tool. */
export async function readActivity(root: string, filter: ActivityFilter = {}): Promise<ActivityEvent[]> {
  let events: ActivityEvent[];
  try {
    events = (await readFile(file(root), 'utf8'))
      .split('\n')
      .filter((line) => line.trim())
      .map(parseLine)
      .filter((e): e is ActivityEvent => e !== null);
  } catch { return []; }

  if (filter.company?.trim()) {
    const needle = norm(filter.company);
    events = events.filter((e) => e.company && norm(e.company).includes(needle));
  }
  if (filter.tool?.trim()) events = events.filter((e) => e.tool === filter.tool!.trim());

  events.reverse();
  return filter.limit && filter.limit > 0 ? events.slice(0, filter.limit) : events;
}

function parseLine(line: string): ActivityEvent | null {
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed.tool === 'string' ? parsed as ActivityEvent : null;
  } catch { return null; }
}
