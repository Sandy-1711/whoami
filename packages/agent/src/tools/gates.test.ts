import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleTools } from '../agent.js';
import { formatConfirm, type ConfirmRequest } from '../confirm.js';
import type { AgentDeps } from '../deps.js';

// Every tool that spends credits, rewrites the grounding, or leaves the machine
// asks the user first, and asks with the values it is about to act on. Two
// things are under test: that a refusal stops the action dead, and that the
// request the user sees carries those values rather than a claim about them.
let root: string;
let tools: Record<string, { execute: (i: any, c: any) => Promise<any> }>;
let asked: ConfirmRequest[];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'resume-gates-'));
  asked = [];
  tools = assembleTools({
    root,
    config: { gmail: { user: 'me@example.com' } },
    mailer: { available: true, send: async () => { throw new Error('should not send'); } },
    llm: { generateJson: async () => { throw new Error('should not call a model'); }, describe: () => ({ label: 'x', modelId: 'x', providerId: 'x' }) },
    confirm: async (req: ConfirmRequest) => { asked.push(req); return false; },
    latex: { availability: () => undefined },
  } as unknown as AgentDeps) as unknown as typeof tools;
});

const GATED = [
  ['tailor_plan', { company: 'Acme AI', jd: 'a'.repeat(40) }],
  ['build_resume', {}],
  ['draft_application_email', { company: 'Acme AI', jd: 'a'.repeat(40) }],
  ['outreach_message', { kind: 'cold_email', company: 'Acme AI' }],
] as const;

describe('confirm gates', () => {
  it.each(GATED)('%s does nothing when the user declines', async (id, input) => {
    const res = await tools[id]!.execute({ ...input }, {});
    expect(asked.map((r) => r.tool)).toEqual([id]);
    expect(res.written ?? res.drafted ?? res.built ?? res.ran ?? false).toBe(false);
    expect(res.reason).toMatch(/cancelled/i);
  });

  it('asks with the real values, not a description of them', async () => {
    await tools.tailor_plan!.execute({ company: 'Acme AI', jd: 'Senior Rust role. '.repeat(4) }, {});
    const [req] = asked;
    expect(req!.params!.company).toBe('Acme AI');
    expect(String(req!.params!['job description'])).toContain('Senior Rust role');
  });

  it('shows every fact-base edit before writing any of them', async () => {
    await mkdir(join(root, 'profile'), { recursive: true });
    await writeFile(join(root, 'profile', 'facts.json'), JSON.stringify({ allowed_keywords: [] }));

    const res = await tools.update_facts!.execute({
      edits: [{ op: 'add_keyword', value: 'Rust' }, { op: 'add_keyword', value: 'WASM' }],
    }, {});
    expect(res.changed).toBe(false);
    expect(asked[0]!.preview).toMatch(/Rust[\s\S]*WASM/);
    const onDisk = JSON.parse(await readFile(join(root, 'profile', 'facts.json'), 'utf8'));
    expect(onDisk.allowed_keywords).toEqual([]);
  });
});

describe('formatConfirm', () => {
  it('aligns the values and quotes the body', () => {
    expect(formatConfirm({
      tool: 'send_application_email',
      action: 'Send this email now',
      params: { to: 'jobs@acme.ai', subject: 'AI Engineer', attachment: undefined },
      preview: 'Hi there,\nI build agent infrastructure.',
    })).toBe([
      'send_application_email — Send this email now',
      '    to       jobs@acme.ai',
      '    subject  AI Engineer',
      '',
      '    │ Hi there,',
      '    │ I build agent infrastructure.',
    ].join('\n'));
  });

  it('truncates a preview that would flood the terminal', () => {
    const out = formatConfirm({ tool: 't', action: 'a', preview: Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') });
    expect(out).toContain('    │ line 29');
    expect(out).not.toContain('    │ line 30');
    expect(out).toContain('… 20 more line(s)');
  });
});
