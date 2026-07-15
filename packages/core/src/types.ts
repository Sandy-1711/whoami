// Shared domain types for the résumé toolkit. Types only — this module has no
// runtime code, so importing it never couples modules at runtime.

// ---- fact base (profile/facts.json) ----------------------------------------

export interface Identity {
  name?: string;
  location?: string;
  email?: string;
  github?: string;
  linkedin?: string;
  portfolio?: string;
  graduation?: string;
}

export interface FactEntry {
  org?: string;
  name?: string;
  role?: string;
  dates?: string;
  keywords?: string[];
  highlights?: string[];
}

export interface Facts {
  identity?: Identity;
  title_variants?: string[];
  seniority?: string;
  allowed_keywords?: string[];
  skills?: Record<string, string[]>;
  experience?: FactEntry[];
  projects?: FactEntry[];
  headline_metrics?: string[];
}

// ---- scoring (scripts/lib/tailor/core.ts) ----------------------------------

export interface Classification {
  matched: string[];
  addable: string[];
  missing: string[];
}

export interface Score {
  before: number;
  after: number;
  total: number;
}

// ---- tailored content (scripts/lib/tailor/gemini.ts) -----------------------

export interface TailorContent {
  roleTitle: string;
  summaryText: string;
  subtitle: string;
  boldTerms: string[];
  rationale: string;
}

// ---- Wellfound (packages/core/src/wellfound/service.ts) --------------------

export interface WellfoundProfile {
  headline: string;
  // Wellfound's bio field, capped at 160 characters (WELLFOUND_BIO_MAX).
  bio: string;
  lookingFor: string;
  // Bullets for Wellfound's Achievements section — carries the proof the short
  // bio can't hold.
  achievements: string[];
  skills: string[];
  // One founder-facing blurb per role/project, to paste under each experience.
  experience: { label: string; blurb: string }[];
}

// ---- output naming (scripts/lib/naming.ts) ---------------------------------

export interface OutputPaths {
  slug: string;
  role: string;
  base: string;
  dir: string;
  relDir: string;
  tex: string;
  pdf: string;
  report: string;
  buildTex: string;
  buildTexRel: string;
  buildPdf: string;
  buildLog: string;
}

// ---- source lock (profile/sources.lock.json) -------------------------------

export interface ScrapeState {
  at: string;
  hash: string;
}

export interface Lock {
  files: Record<string, string | null>;
  scrape: Record<string, ScrapeState>;
  updatedAt?: string;
}

// ---- scrape results --------------------------------------------------------

export interface GithubRepo {
  name: string;
  description: string;
  url: string;
  homepage: string;
  stars: number;
  language: string;
  topics: string[];
  archived: boolean;
  pushedAt: string;
  // Quality-gate signals (evidence architecture, Stage A). `fork` lets the gate
  // down-weight forks; `readmeSize` (bytes, 0 if none) distinguishes substantial
  // projects from empty experiments.
  fork: boolean;
  readmeSize: number;
  // Set by profile/curation.json — pinned repos are always surfaced first.
  pinned?: boolean;
}

export interface GithubContribution {
  repo: string;
  url: string;
  merged: number;
  open: number;
  closedUnmerged: number;
  stars?: number;
  samplePRs: { number: number; title: string; state: string; url: string }[];
  // Set by profile/curation.json — pinned contributions are always surfaced first.
  pinned?: boolean;
}

export interface GithubTotals {
  publicRepos: number;
  totalStars: number;
  mergedPRs: number;
  externalRepos: number;
}

export interface GithubData {
  _comment: string;
  scrapedAt: string;
  username: string;
  profileUrl: string;
  totals: GithubTotals;
  repos: GithubRepo[];
  contributions: GithubContribution[];
}

export interface LinkedinExperience {
  company: string;
  title: string;
  dates?: string;
  location?: string;
  description?: string;
}

export interface LinkedinEducation {
  school: string;
  degree?: string;
  field?: string;
  dates?: string;
}

export interface LinkedinProfile {
  name: string;
  headline: string;
  location?: string;
  about?: string;
  experience: LinkedinExperience[];
  education: LinkedinEducation[];
  skills: string[];
  certifications?: string[];
}

export interface LinkedinData {
  _comment: string;
  scrapedAt: string;
  via: string;
  liveError?: string;
  profileUrl: string;
  profile: LinkedinProfile;
}

// The per-source outcome the refresh orchestrator reports back to the CLI.
// 'skipped' — the source was deliberately not touched (e.g. LinkedIn's opt-in gate).
export type ScrapeStatus = 'fresh' | 'created' | 'updated' | 'unchanged' | 'error' | 'skipped';

export interface RefreshResult {
  source: string;
  status: ScrapeStatus;
  at?: string;
  error?: string;
  data?: GithubData | LinkedinData;
}
