import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeLatexCompiler, fakePdfInspector } from '@resume/core/testing';
import type { AppConfig, Resume, StatusReport } from '@resume/core';
import type { Cli } from '@resume/cli';
import type { UserAnswer } from '@resume/agent';
import { createApp } from './app.js';
import { PendingRequests } from './pending.js';
import type { Studio } from './studio.js';

const RESUME: Resume = {
  name: 'Ada Lovelace',
  subtitle: ['Engineer'],
  contacts: ['[ada@example.com](mailto:ada@example.com)'],
  summary: 'Builds things that compute.',
  experience: [{
    id: 'exp-engines',
    org: 'Analytical Engines',
    role: 'Engineer',
    dates: '2024 — present',
    location: 'Remote',
    bullets: [{ id: 'exp-engines-loom', text: 'Wove **algebraic patterns** into a loom.' }],
  }],
  projects: [],
  skills: [{ id: 'skills-languages', label: 'Languages', items: ['TypeScript'] }],
  education: [{ id: 'edu-somewhere', school: 'Somewhere', degree: 'BSc', dates: '2026', location: 'Remote' }],
};

const config: AppConfig = {
  llm: { provider: '', keys: {}, models: {}, timeoutMs: 0 },
  gmail: { user: '', appPassword: '' },
  githubToken: '',
  linkedinCookie: '',
  scrapeTtlHours: 12,
};

interface StatusBody {
  report: StatusReport;
  langfuse: { enabled: boolean; url: string };
}

const roots: string[] = [];

// Everything the routes under test actually reach. The chat turn is not one of
// them: it needs a model, and the pieces it is made of are covered on their own.
function testStudio(): { studio: Studio; root: string; deleted: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'studio-'));
  roots.push(root);
  const deleted: string[] = [];
  const memory = {
    listThreads: async () => ({ threads: [{ id: 't1', title: 'Acme outreach', updatedAt: new Date(0) }] }),
    recall: async () => ({
      messages: [{ id: 'm1', role: 'user', createdAt: new Date(0), content: { parts: [{ type: 'text', text: 'hello' }] } }],
    }),
    deleteThread: async (id: string) => { deleted.push(id); },
  };
  const studio: Studio = {
    cli: {
      root,
      config,
      latex: fakeLatexCompiler(),
      pdf: fakePdfInspector(),
    } as unknown as Cli,
    memory: { memory, semanticRecall: false, dbPath: '' } as unknown as Studio['memory'],
    observability: undefined,
    confirms: new PendingRequests<boolean>(),
    asks: new PendingRequests<UserAnswer[] | null>(),
  };
  return { studio, root, deleted };
}

// Hono's test client types a response body as unknown; every assertion below
// states the shape it is checking, so read it back at that shape.
const body = <T>(res: Response): Promise<T> => res.json() as Promise<T>;

function writeResume(root: string, resume: unknown): void {
  mkdirSync(join(root, 'profile'), { recursive: true });
  writeFileSync(join(root, 'profile', 'resume.json'), JSON.stringify(resume));
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('GET /api/status', () => {
  it('reports the toolchain and where to find the traces', async () => {
    const { studio } = testStudio();
    const res = await createApp(studio).request('/api/status');

    expect(res.status).toBe(200);
    const status = await body<StatusBody>(res);
    expect(status.report.env.anyKey).toBe(false);
    expect(status.langfuse).toEqual({ enabled: false, url: 'http://localhost:3000' });
  });
});

describe('GET /api/resume', () => {
  it('says which file is missing rather than returning nothing', async () => {
    const { studio } = testStudio();
    const res = await createApp(studio).request('/api/resume');

    expect(res.status).toBe(404);
    expect((await body<{ error: string }>(res)).error).toContain('profile/resume.json');
  });

  it('returns the parsed document', async () => {
    const { studio, root } = testStudio();
    writeResume(root, RESUME);

    const res = await createApp(studio).request('/api/resume');
    expect(res.status).toBe(200);
    expect((await body<{ resume: Resume }>(res)).resume.name).toBe('Ada Lovelace');
  });
});

describe('PUT /api/resume', () => {
  const put = (body: unknown) => ({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  it('rejects a document that does not parse, naming the field', async () => {
    const { studio, root } = testStudio();
    writeResume(root, RESUME);

    const res = await createApp(studio).request('/api/resume', put({ ...RESUME, subtitle: [] }));

    expect(res.status).toBe(400);
    expect((await body<{ error: string }>(res)).error).toContain('subtitle');
  });

  it('leaves the document on disk untouched when the edit is invalid', async () => {
    const { studio, root } = testStudio();
    writeResume(root, RESUME);

    await createApp(studio).request('/api/resume', put({ ...RESUME, subtitle: [] }));

    const onDisk = JSON.parse(readFileSync(join(root, 'profile', 'resume.json'), 'utf8'));
    expect(onDisk.subtitle).toEqual(['Engineer']);
  });

  it('writes the document and re-renders resume.tex with it', async () => {
    const { studio, root } = testStudio();
    writeResume(root, RESUME);

    const edited = { ...RESUME, summary: 'Builds engines that compute.' };
    const res = await createApp(studio).request('/api/resume', put(edited));

    expect(res.status).toBe(200);
    expect(JSON.parse(readFileSync(join(root, 'profile', 'resume.json'), 'utf8')).summary)
      .toBe('Builds engines that compute.');
    expect(readFileSync(join(root, 'resume.tex'), 'utf8')).toContain('Builds engines that compute.');
  });
});

describe('GET /api/outputs', () => {
  it('lists nothing when nothing has been tailored', async () => {
    const { studio } = testStudio();
    const res = await createApp(studio).request('/api/outputs');

    expect(await body<unknown>(res)).toEqual({ outputs: [] });
  });

  it('refuses a path that climbs out of tailored/', async () => {
    const { studio, root } = testStudio();
    writeFileSync(join(root, 'secret.pdf'), '%PDF-1.4');

    const res = await createApp(studio).request('/api/outputs/..%2Fsecret.pdf');

    expect(res.status).toBe(400);
  });

  it('refuses anything that is not a PDF', async () => {
    const { studio } = testStudio();
    const res = await createApp(studio).request('/api/outputs/acme/notes.txt');

    expect(res.status).toBe(400);
  });

  it('serves a tailored PDF', async () => {
    const { studio, root } = testStudio();
    mkdirSync(join(root, 'tailored', 'acme'), { recursive: true });
    writeFileSync(join(root, 'tailored', 'acme', 'Ada - Engineer.pdf'), '%PDF-1.4\n');

    const res = await createApp(studio).request('/api/outputs/acme/Ada%20-%20Engineer.pdf');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });
});

describe('POST /api/files', () => {
  it('saves a pasted JD and hands back a path the tools accept', async () => {
    const { studio, root } = testStudio();
    const form = new FormData();
    form.set('name', 'Acme — Staff Engineer.txt');
    form.set('text', 'We are hiring a Staff Engineer.');

    const res = await createApp(studio).request('/api/files', { method: 'POST', body: form });

    expect(res.status).toBe(200);
    const { path } = await body<{ path: string }>(res);
    expect(path.startsWith(join(root, '.agent', 'jd'))).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('We are hiring a Staff Engineer.');
  });

  it('refuses an empty upload', async () => {
    const { studio } = testStudio();
    const form = new FormData();
    form.set('text', '   ');

    const res = await createApp(studio).request('/api/files', { method: 'POST', body: form });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/chat', () => {
  it('will not start a turn without a message', async () => {
    const { studio } = testStudio();
    const res = await createApp(studio).request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: 't1' }),
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/confirm/:id', () => {
  const post = (approved: boolean) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved }),
  });

  it('settles the gate the tool is waiting on', async () => {
    const { studio } = testStudio();
    let id = '';
    const approved = studio.confirms.put({ timeoutMs: 1000, fallback: false, emit: (given) => { id = given; } });

    const res = await createApp(studio).request(`/api/confirm/${id}`, post(true));

    expect(res.status).toBe(200);
    await expect(approved).resolves.toBe(true);
  });

  it('404s an id nothing is waiting under, instead of silently approving', async () => {
    const { studio } = testStudio();
    const res = await createApp(studio).request('/api/confirm/not-a-pending-id', post(true));

    expect(res.status).toBe(404);
  });
});

describe('GET /api/threads', () => {
  it('lists past conversations from the agent’s own memory', async () => {
    const { studio } = testStudio();
    const res = await createApp(studio).request('/api/threads');

    expect((await body<{ threads: unknown[] }>(res)).threads).toEqual([
      { id: 't1', title: 'Acme outreach', updatedAt: new Date(0).toISOString() },
    ]);
  });

  it('flattens a thread to what the transcript redraws', async () => {
    const { studio } = testStudio();
    const res = await createApp(studio).request('/api/threads/t1');

    expect((await body<{ messages: unknown[] }>(res)).messages).toEqual([
      {
        id: 'm1', role: 'user', text: 'hello', reasoning: '', calls: [], artifacts: [],
        createdAt: new Date(0).toISOString(),
      },
    ]);
  });
});

describe('DELETE /api/threads/:id', () => {
  it('deletes the thread it was asked about, and nothing else', async () => {
    const { studio, deleted } = testStudio();
    const res = await createApp(studio).request('/api/threads/t1', { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(deleted).toEqual(['t1']);
  });

  it('takes an id the store no longer has without complaining', async () => {
    const { studio } = testStudio();
    const res = await createApp(studio).request('/api/threads/gone', { method: 'DELETE' });

    expect(res.status).toBe(200);
  });
});
