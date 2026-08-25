// Application-tracker tools — read the history the toolkit keeps of itself, and
// record the parts of it only a human can know. Tailoring, drafting and sending
// log themselves (see recording.ts), so log_application exists for what happens
// off-machine: a reply, an interview, a rejection.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { AgentDeps } from '../deps.js';
import { logApplication, listApplications } from '../tracker.js';
import { readActivity } from '../activity.js';
import { cap } from './shared.js';
import { describeTool } from './describe.js';

export function trackerTools(deps: AgentDeps) {
  const log_application = createTool({
    id: 'log_application',
    description: describeTool({
      does:
        'Record a change in an application that this toolkit cannot observe for itself: a reply, a ' +
        'scheduled interview, a rejection, an offer, going quiet. Upserts by company and role, so ' +
        'logging the same one again advances it instead of duplicating it.',
      cost: 'local',
      use: 'the user tells you something happened off-machine.',
      avoid: 'anything the toolkit just did — tailoring, drafting and sending record themselves, with the files they produced.',
      then: 'list_applications shows the state you just wrote.',
    }),
    inputSchema: z.object({
      company: z.string().describe('Company name.'),
      role: z.string().optional().describe('Role applied for.'),
      channel: z.string().optional().describe('email | wellfound | linkedin | referral | portal | other.'),
      status: z.string().optional().describe('drafted | tailored | applied | sent | interviewing | rejected | offer | ghosted …'),
      notes: z.string().optional().describe('Anything worth remembering (recruiter name, next step, deadline).'),
      artifacts: z.array(z.string()).optional().describe('Related file paths (résumé, email draft).'),
    }),
    execute: async ({ company, role, channel, status, notes, artifacts }) => {
      const entry = await logApplication(deps.root, { company, role, channel, status, notes, artifacts });
      return { logged: true, id: entry.id, company: entry.company, role: entry.role, status: entry.status, channel: entry.channel, updatedAt: entry.updatedAt };
    },
  });

  const list_applications = createTool({
    id: 'list_applications',
    description: describeTool({
      does:
        'List tracked applications, newest activity first — every company this toolkit has tailored ' +
        'for, drafted to or sent to, plus whatever was logged by hand. Filter by company substring or ' +
        'exact status; set `activity` for the recorded history of what was actually done for each, ' +
        'with timestamps and the files produced.',
      cost: 'free',
      use: 'answering "where am I with X?" or "what have I applied to?", and before starting work for a company — it may already have been done.',
      avoid: 'listing generated files — that is list_outputs.',
    }),
    inputSchema: z.object({
      company: z.string().optional().describe('Case-insensitive company substring.'),
      status: z.string().optional().describe('Exact status to filter by.'),
      activity: z.boolean().optional().describe('Attach each application\'s recent recorded actions.'),
    }),
    execute: async ({ company, status, activity }) => {
      const apps = await listApplications(deps.root, { company, status });
      const listed = cap(apps, 30);
      return {
        count: apps.length,
        applications: await Promise.all(listed.map(async (a) => ({
          company: a.company,
          role: a.role,
          status: a.status,
          channel: a.channel,
          updatedAt: a.updatedAt,
          notes: a.notes || undefined,
          artifacts: a.artifacts.length ? a.artifacts : undefined,
          ...(activity ? { activity: await companyActivity(deps.root, a.company) } : {}),
        }))),
      };
    },
  });

  return { log_application, list_applications };
}

async function companyActivity(root: string, company: string) {
  const events = await readActivity(root, { company, limit: 8 });
  return events.map((e) => ({ at: e.ts, did: e.tool, ok: e.ok, detail: e.detail }));
}
