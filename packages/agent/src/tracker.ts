// The application tracker — machine-local job-application state under
// .agent/applications.json (gitignored). Upsert-by-company/role so re-logging the
// same application advances its status instead of duplicating it. The agent keeps
// this honest: sends auto-log here, and the model updates statuses as things move.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export interface Application {
  id: string;
  company: string;
  role: string;
  channel: string;    // email | wellfound | linkedin | referral | portal | other
  status: string;     // drafted | sent | applied | interviewing | rejected | offer | ghosted | ...
  date: string;       // ISO — first logged
  updatedAt: string;  // ISO — last change
  artifacts: string[];
  notes: string;
}

export interface LogInput {
  company: string;
  role?: string;
  channel?: string;
  status?: string;
  artifacts?: string[];
  notes?: string;
}

const file = (root: string): string => join(root, '.agent', 'applications.json');
const norm = (s: string): string => s.trim().toLowerCase();

async function readAll(root: string): Promise<Application[]> {
  try {
    const parsed = JSON.parse(await readFile(file(root), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function writeAll(root: string, apps: Application[]): Promise<void> {
  await mkdir(join(root, '.agent'), { recursive: true });
  await writeFile(file(root), JSON.stringify(apps, null, 2) + '\n');
}

// Upsert by company (+ role when given). Advances an existing entry rather than
// duplicating; merges artifacts. Returns the stored entry.
export async function logApplication(root: string, input: LogInput): Promise<Application> {
  if (!input.company?.trim()) throw new Error('An application needs a company.');
  const apps = await readAll(root);
  const role = (input.role || '').trim();
  const now = new Date().toISOString();

  const match = apps.find((a) =>
    norm(a.company) === norm(input.company) && (!role || norm(a.role) === norm(role)));

  if (match) {
    if (input.role) match.role = role;
    if (input.channel) match.channel = input.channel;
    if (input.status) match.status = input.status;
    if (input.notes) match.notes = input.notes;
    if (input.artifacts?.length) match.artifacts = [...new Set([...match.artifacts, ...input.artifacts])];
    match.updatedAt = now;
    await writeAll(root, apps);
    return match;
  }

  const entry: Application = {
    id: randomUUID(),
    company: input.company.trim(),
    role,
    channel: input.channel || 'other',
    status: input.status || 'applied',
    date: now,
    updatedAt: now,
    artifacts: input.artifacts ?? [],
    notes: input.notes || '',
  };
  apps.push(entry);
  await writeAll(root, apps);
  return entry;
}

export interface ListFilter {
  company?: string;
  status?: string;
}

export async function listApplications(root: string, filter: ListFilter = {}): Promise<Application[]> {
  let apps = await readAll(root);
  if (filter.company?.trim()) apps = apps.filter((a) => norm(a.company).includes(norm(filter.company!)));
  if (filter.status?.trim()) apps = apps.filter((a) => norm(a.status) === norm(filter.status!));
  return apps.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
