import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emailTools } from './email.js';
import { denyGate } from '../confirm.js';
import type { AgentDeps } from '../deps.js';

// A mailer that reports available so we reach the confirm gate, but a send would
// only happen past deny — which never returns true here.
function depsFor(root: string): AgentDeps {
  return {
    root,
    config: { gmail: { user: 'me@example.com' } },
    mailer: { available: true, send: async () => { throw new Error('should not send'); } },
    confirm: denyGate,
  } as unknown as AgentDeps;
}

async function run<T>(tool: { execute?: (i: any, c: any) => Promise<T> }, input: unknown): Promise<T> {
  if (!tool.execute) throw new Error('no execute');
  return tool.execute(input as any, {} as any);
}

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'resume-email-')); });

describe('emailTools', () => {
  it('exposes draft + send tools', () => {
    expect(Object.keys(emailTools(depsFor(root))).sort()).toEqual(['draft_application_email', 'send_application_email']);
  });

  it('send names the file it looked for when there is no draft anywhere', async () => {
    const tools = emailTools(depsFor(root));
    await expect(run(tools.send_application_email, { company: 'Acme AI' }))
      .rejects.toThrow(/tailored\/acme_ai\/application-email\.txt/);
  });

  it('send falls back to the draft saved on disk in an earlier session', async () => {
    await mkdir(join(root, 'tailored', 'acme_ai'), { recursive: true });
    await writeFile(
      join(root, 'tailored', 'acme_ai', 'application-email.txt'),
      'To: jobs@acme.ai\nSubject: AI Engineer\n\nI build agent infrastructure.\n',
    );

    // The deny gate stands in for the user declining, which is as far as a test
    // may go — reaching it proves the draft was found and read.
    const tools = emailTools(depsFor(root));
    const res: any = await run(tools.send_application_email, { company: 'Acme AI' });
    expect(res).toEqual({ sent: false, reason: 'Cancelled — not sent.' });
  });
});
