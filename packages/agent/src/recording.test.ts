import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordTools } from './recording.js';
import { readActivity } from './activity.js';
import { listApplications, logApplication } from './tracker.js';
import { assembleTools } from './agent.js';
import type { AgentDeps } from './deps.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'resume-rec-')); });

const call = (tool: unknown, input: unknown): Promise<unknown> =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<unknown> }).execute(input, {});

describe('recordTools', () => {
  it('records a call without the tool knowing about it', async () => {
    const tools = recordTools(root, {
      score_jd: { execute: async () => ({ score: { current: 40, max: 100 }, missing: ['rust'] }) },
    });
    await call(tools.score_jd, { jd: 'a job description' });

    const [event] = await readActivity(root);
    expect(event.tool).toBe('score_jd');
    expect(event.ok).toBe(true);
    expect(event.detail).toBe('score 40/100, 1 gaps');
    expect(typeof event.ms).toBe('number');
  });

  it('advances the application for a tool that moves one forward', async () => {
    const tools = recordTools(root, {
      tailor_resume: { execute: async () => ({ pdf: 'tailored/acme/resume.pdf', score: {}, guardsPass: true }) },
    });
    await call(tools.tailor_resume, { company: 'Acme AI', role: 'AI Engineer' });

    const [app] = await listApplications(root);
    expect(app.company).toBe('Acme AI');
    expect(app.status).toBe('tailored');
    expect(app.artifacts).toContain('tailored/acme/resume.pdf');
  });

  it('never walks an application backwards', async () => {
    await logApplication(root, { company: 'Acme AI', status: 'interviewing' });
    const tools = recordTools(root, {
      tailor_resume: { execute: async () => ({ pdf: 'tailored/acme/resume.pdf' }) },
    });
    await call(tools.tailor_resume, { company: 'Acme AI' });

    const [app] = await listApplications(root);
    expect(app.status).toBe('interviewing');
    expect(app.artifacts).toContain('tailored/acme/resume.pdf');
  });

  it('leaves the tracker alone for a call that advances nothing', async () => {
    const tools = recordTools(root, {
      read_profile: { execute: async () => ({ facts: {} }) },
    });
    await call(tools.read_profile, {});
    expect(await listApplications(root)).toHaveLength(0);
    expect(await readActivity(root)).toHaveLength(1);
  });

  it('records a failure and still throws it', async () => {
    const tools = recordTools(root, {
      send_application_email: { execute: async () => { throw new Error('SMTP refused the connection'); } },
    });
    await expect(call(tools.send_application_email, { company: 'Acme AI' })).rejects.toThrow(/SMTP/);

    const [event] = await readActivity(root);
    expect(event.ok).toBe(false);
    expect(event.detail).toMatch(/SMTP/);
    expect(event.company).toBe('Acme AI');
  });

  it('reads back only the events for one company', async () => {
    const tools = recordTools(root, { outreach_message: { execute: async () => ({ kind: 'cold_email', wordCount: 90 }) } });
    await call(tools.outreach_message, { company: 'Acme AI', kind: 'cold_email' });
    await call(tools.outreach_message, { company: 'Globex', kind: 'cold_email' });

    const events = await readActivity(root, { company: 'acme' });
    expect(events).toHaveLength(1);
    expect(events[0].company).toBe('Acme AI');
  });
});

describe('assembleTools', () => {
  // The tools are Mastra instances, not plain objects: this is what proves the
  // decoration survives them, and that chat and MCP both inherit it.
  it('records through the real tool set', async () => {
    const tools = assembleTools({ root } as unknown as AgentDeps);
    await call(tools.list_applications, {});

    const [event] = await readActivity(root);
    expect(event.tool).toBe('list_applications');
    expect(JSON.parse(await readFile(join(root, '.agent', 'activity.jsonl'), 'utf8').then((s) => s.trim())).ok).toBe(true);
  });
});
