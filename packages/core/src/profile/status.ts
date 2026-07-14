// Structured status report — the data behind `resume status` and the agent's
// profile_status tool. Pure I/O over the repo (fs + the lock), with the two
// environment probes that need spawnSync/node_modules (render engine, Playwright)
// injected by the caller so this module stays testable and CLI-free.
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readLock, drift } from './sources.js';
import type { AppConfig } from '../ports/config.js';
import type { EngineReason } from '../ports/latex.js';
import type { GithubData, LinkedinData } from '../types.js';

export interface ProviderStatus {
  id: string;
  label: string;
  keySet: boolean;
  model: string;
  active: boolean;
}

export interface SourceFreshness {
  present: boolean;
  summary: string;      // human one-liner, e.g. "47 repos · 31★ · 20 merged PRs"
  scrapedAt?: string;   // ISO, when it was last scraped
}

export interface TailoredOutput {
  path: string;         // absolute
  relPath: string;      // relative to tailored/, forward-slashed
  mtime: string;        // ISO
}

export interface StatusReport {
  env: {
    activeProvider: string;
    anyKey: boolean;
    providers: ProviderStatus[];
    githubToken: boolean;
    linkedin: { live: boolean; detail: string };
  };
  toolchain: { canRender: boolean; reason: EngineReason | null };
  sources: {
    github: SourceFreshness;
    linkedin: SourceFreshness;
    drift: { hasBaseline: boolean; synced: boolean; changed: string[] };
  };
  canonical: { built: boolean; sizeKb?: number; builtAt?: string };
  tailored: TailoredOutput[];
}

export interface CollectStatusInput {
  root: string;
  config: AppConfig;
  // Registered providers (id/label/default model), from the LLM registry.
  providers: { id: string; label: string; defaultModel: string }[];
  activeProviderId: string;
  // Injected env probes (spawnSync / node_modules lookups live in the CLI).
  renderReason: EngineReason | null;
  playwright: boolean;
}

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return null; }
}

// List tailored PDFs on disk, newest first. Shared by `status` and list_outputs.
export async function listTailoredOutputs(root: string): Promise<TailoredOutput[]> {
  const dir = join(root, 'tailored');
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  const out: TailoredOutput[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.pdf')) continue;
    // Node's recursive readdir exposes the parent as parentPath (newer) or path (older).
    const parent = (e as unknown as { parentPath?: string; path?: string }).parentPath
      ?? (e as unknown as { path?: string }).path
      ?? dir;
    const path = join(parent, e.name);
    try {
      const mtime = (await stat(path)).mtime.toISOString();
      out.push({ path, relPath: relative(dir, path).replace(/\\/g, '/'), mtime });
    } catch { /* skip unreadable */ }
  }
  return out.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
}

export async function collectStatus(input: CollectStatusInput): Promise<StatusReport> {
  const { root, config, providers, activeProviderId, renderReason, playwright } = input;

  const providerStatuses: ProviderStatus[] = providers.map((f) => ({
    id: f.id,
    label: f.label,
    keySet: Boolean(config.llm.keys[f.id]),
    model: config.llm.models[f.id] || f.defaultModel,
    active: activeProviderId === f.id && Boolean(config.llm.keys[f.id]),
  }));
  const anyKey = providerStatuses.some((p) => p.keySet);

  const gh = await readJson<GithubData>(join(root, 'profile', 'github.json'));
  const li = await readJson<LinkedinData>(join(root, 'profile', 'linkedin.json'));
  const lock = await readLock(root);
  const d = await drift(root);

  const canonicalPath = join(root, 'apps', 'web', 'assets', 'resume.pdf');
  let canonical: StatusReport['canonical'] = { built: false };
  if (existsSync(canonicalPath)) {
    const s = await stat(canonicalPath);
    canonical = { built: true, sizeKb: Math.round(s.size / 1024), builtAt: s.mtime.toISOString() };
  }

  return {
    env: {
      activeProvider: activeProviderId,
      anyKey,
      providers: providerStatuses,
      githubToken: Boolean(config.githubToken),
      linkedin: {
        live: Boolean(config.linkedinCookie) && playwright,
        detail: `${config.linkedinCookie ? 'cookie set' : 'no cookie'}, ${playwright ? 'Playwright ready' : 'Playwright not installed'}`,
      },
    },
    toolchain: { canRender: renderReason === null, reason: renderReason },
    sources: {
      github: {
        present: Boolean(gh),
        summary: gh
          ? `${gh.totals?.publicRepos ?? '?'} repos · ${gh.totals?.totalStars ?? '?'}★ · ${gh.totals?.mergedPRs ?? '?'} merged PRs`
          : 'not scraped yet',
        scrapedAt: lock.scrape?.github?.at,
      },
      linkedin: {
        present: Boolean(li),
        summary: li ? `${li.profile?.experience?.length ?? '?'} roles · via ${li.via}` : 'not scraped yet',
        scrapedAt: lock.scrape?.linkedin?.at,
      },
      drift: { hasBaseline: Boolean(d.lock), synced: d.synced, changed: d.changed },
    },
    canonical,
    tailored: await listTailoredOutputs(root),
  };
}
