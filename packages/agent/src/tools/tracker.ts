// Application-tracker tools — log and list job applications in
// .agent/applications.json. send_application_email auto-logs here; the model uses
// log_application to record other channels and advance statuses over time.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { AgentDeps } from '../deps.js';
import { logApplication, listApplications } from '../tracker.js';
import { cap } from './shared.js';

export function trackerTools(deps: AgentDeps) {
  const log_application = createTool({
    id: 'log_application',
    description:
      'Record or update a job application in the tracker. Upserts by company (+ role): re-logging the ' +
      'same one advances its status instead of duplicating. Use after sending/applying and whenever a ' +
      'status changes (applied → interviewing → offer/rejected). Keep it honest and current.',
    inputSchema: z.object({
      company: z.string().describe('Company name.'),
      role: z.string().optional().describe('Role applied for.'),
      channel: z.string().optional().describe('email | wellfound | linkedin | referral | portal | other.'),
      status: z.string().optional().describe('drafted | sent | applied | interviewing | rejected | offer | ghosted …'),
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
    description:
      'List tracked job applications, newest activity first. Filter by company substring or exact ' +
      'status. Use to answer "where am I with X?" or "what have I applied to?".',
    inputSchema: z.object({
      company: z.string().optional().describe('Case-insensitive company substring.'),
      status: z.string().optional().describe('Exact status to filter by.'),
    }),
    execute: async ({ company, status }) => {
      const apps = await listApplications(deps.root, { company, status });
      return {
        count: apps.length,
        applications: cap(apps.map((a) => ({
          company: a.company, role: a.role, status: a.status, channel: a.channel, updatedAt: a.updatedAt, notes: a.notes || undefined,
        })), 30),
      };
    },
  });

  return { log_application, list_applications };
}
