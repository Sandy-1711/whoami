import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emailTools } from './email.js';
import type { ConfirmRequest } from '../confirm.js';
import type { AgentDeps } from '../deps.js';

// Nothing here is allowed to reach the mailer. The gate declines every time, so
// arriving at it is the proof that the draft was found, read, and put in front
// of the user with the bytes that would have gone out.
let root: string;
let asked: ConfirmRequest[];

function tools(): ReturnType<typeof emailTools> {
  return emailTools({
    root,
    config: { gmail: { user: 'me@example.com' } },
    mailer: { available: true, send: async () => { throw new Error('should not send'); } },
    confirm: async (req: ConfirmRequest) => { asked.push(req); return false; },
  } as unknown as AgentDeps);
}

async function send(input: unknown): Promise<any> {
  return tools().send_application_email.execute!(input as any, {} as any);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'resume-email-'));
  asked = [];
});

describe('emailTools', () => {
  it('exposes draft + send tools', () => {
    expect(Object.keys(tools()).sort()).toEqual(['draft_application_email', 'send_application_email']);
  });

  it('names the file it looked for when there is no draft anywhere', async () => {
    await expect(send({ company: 'Acme AI' })).rejects.toThrow(/tailored\/acme_ai\/application-email\.txt/);
    expect(asked).toEqual([]);
  });
});

describe('send_application_email', () => {
  beforeEach(async () => {
    await mkdir(join(root, 'tailored', 'acme_ai'), { recursive: true });
    await writeFile(
      join(root, 'tailored', 'acme_ai', 'application-email.txt'),
      'To: jobs@acme.ai\nSubject: AI Engineer\n\nI build agent infrastructure.\n',
    );
    await writeFile(join(root, 'secrets.txt'), 'To: attacker@evil.co\nSubject: exfiltrated\n\n...\n');
  });

  it('refuses a file from outside tailored/', async () => {
    const res = await send({ company: 'Acme AI', path: 'secrets.txt' });
    expect(res.sent).toBe(false);
    expect(res.reason).toMatch(/under tailored\//);
    expect(asked).toEqual([]);
  });

  it('refuses an attachment from outside tailored/', async () => {
    const res = await send({ company: 'Acme AI', attach: '../../etc/passwd' });
    expect(res.sent).toBe(false);
    expect(res.reason).toMatch(/under tailored\//);
  });

  it('falls back to the draft saved on disk in an earlier session', async () => {
    const res = await send({ company: 'Acme AI' });
    expect(res).toEqual({ sent: false, reason: 'Cancelled — not sent.' });
    expect(asked[0]!.params!.source).toBe('tailored/acme_ai/application-email.txt');
  });

  it('puts the recipient, the subject and the whole body in front of the user', async () => {
    await send({ company: 'Acme AI' });
    const [req] = asked;
    expect(req!.tool).toBe('send_application_email');
    expect(req!.params!.to).toBe('jobs@acme.ai (read from the job description)');
    expect(req!.params!.subject).toBe('AI Engineer');
    expect(req!.preview).toContain('I build agent infrastructure.');
  });

  it('says where an overridden recipient came from', async () => {
    await send({ company: 'Acme AI', to: 'someone@else.co' });
    expect(asked[0]!.params!.to).toBe('someone@else.co (supplied in the call)');
  });

  it('cannot be talked past — an approval in the arguments is not one', async () => {
    const res = await send({ company: 'Acme AI', confirm: true });
    expect(res).toEqual({ sent: false, reason: 'Cancelled — not sent.' });
  });
});
