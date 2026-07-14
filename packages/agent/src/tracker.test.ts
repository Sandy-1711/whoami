import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logApplication, listApplications } from './tracker.js';

describe('application tracker', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'tracker-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('creates then upserts by company+role instead of duplicating', async () => {
    await logApplication(root, { company: 'Acme', role: 'AI Engineer', channel: 'email', status: 'sent' });
    await logApplication(root, { company: 'Acme', role: 'AI Engineer', status: 'interviewing', notes: 'call Tuesday' });
    const apps = await listApplications(root);
    expect(apps).toHaveLength(1);
    expect(apps[0]!.status).toBe('interviewing');
    expect(apps[0]!.channel).toBe('email');       // preserved from the first log
    expect(apps[0]!.notes).toBe('call Tuesday');
  });

  it('keeps distinct roles at the same company separate', async () => {
    await logApplication(root, { company: 'Acme', role: 'AI Engineer' });
    await logApplication(root, { company: 'Acme', role: 'Backend Engineer' });
    expect(await listApplications(root)).toHaveLength(2);
  });

  it('merges artifacts and filters by status', async () => {
    await logApplication(root, { company: 'Acme', role: 'AI Engineer', status: 'sent', artifacts: ['a.pdf'] });
    await logApplication(root, { company: 'Acme', role: 'AI Engineer', artifacts: ['a.pdf', 'email.txt'] });
    const [app] = await listApplications(root, { status: 'sent' });
    expect(app!.artifacts.sort()).toEqual(['a.pdf', 'email.txt']);
    expect(await listApplications(root, { status: 'rejected' })).toHaveLength(0);
  });
});
