import { describe, it, expect } from 'vitest';
import { emailTools } from './email.js';
import { denyGate } from '../confirm.js';
import type { AgentDeps } from '../deps.js';

// A mailer that reports available so we reach the confirm gate, but a send would
// only happen past deny — which never returns true here.
const deps = {
  root: process.cwd(),
  config: { gmail: { user: 'me@example.com' } },
  mailer: { available: true, send: async () => { throw new Error('should not send'); } },
  confirm: denyGate,
} as unknown as AgentDeps;

async function run<T>(tool: { execute?: (i: any, c: any) => Promise<T> }, input: unknown): Promise<T> {
  if (!tool.execute) throw new Error('no execute');
  return tool.execute(input as any, {} as any);
}

describe('emailTools', () => {
  const tools = emailTools(deps);

  it('exposes draft + send tools', () => {
    expect(Object.keys(tools).sort()).toEqual(['draft_application_email', 'send_application_email']);
  });

  it('send refuses when nothing was drafted for the company', async () => {
    await expect(run(tools.send_application_email, { company: 'Acme' })).rejects.toThrow(/draft_application_email first/i);
  });
});
