// @resume/core public surface. The CLI and any other consumer import from here.

// Ports (the interfaces consumers implement or depend on).
export * from './ports/http.js';
export * from './ports/llm.js';
export * from './ports/config.js';
export * from './ports/latex.js';
export * from './ports/logger.js';
export * from './ports/mailer.js';
export * from './ports/embedding.js';

// LLM registry + provider factories.
export * from './llm/registry.js';
export { geminiFactory } from './llm/providers/gemini.js';
export { deepseekFactory } from './llm/providers/deepseek.js';
export { createGeminiEmbedder, GEMINI_EMBED_MODEL } from './llm/providers/gemini-embedder.js';

// Domain types + pure helpers.
export * from './types.js';
export * from './format.js';
export * from './naming.js';
export * from './prompts.js';

// Tailoring.
export * from './tailor/core.js';
export * from './tailor/report.js';
export * from './tailor/service.js';
export * from './tailor/coverage.js';

// Wellfound (application-box note + profile refresh).
export * from './wellfound/service.js';

// Profile enhancer (fact base vs live surfaces → paste-ready suggestions).
export * from './enhance/service.js';

// Outreach messages (cold email / LinkedIn DM / follow-up / referral ask).
export * from './outreach/service.js';

// Job-application email (draft + send via the Mailer port).
export * from './email/service.js';

// Profile sources + scraping.
export * from './profile/sources.js';
export * from './profile/status.js';
export * from './profile/facts-editor.js';

// Evidence store (canonical proof units + curation tiers — architecture L1-3).
export * from './evidence/store.js';
export * from './evidence/embedding.js';
export * from './evidence/gate.js';
export * from './evidence/normalize.js';
export * from './evidence/extract.js';
export * from './evidence/dedup.js';
export * from './evidence/ingest.js';
export * from './evidence/requirements.js';
export * from './evidence/relevance.js';
export * from './evidence/selector.js';
export * from './evidence/writer.js';
export * from './evidence/lockfile.js';
export * from './evidence/anchors.js';
export * from './evidence/audit.js';

// GitHub profile writes (bio, repo descriptions, profile README).
export * from './github/profile.js';
export * from './scrape/github.js';
export * from './scrape/linkedin.js';
export * from './scrape/refresh.js';

// Guards.
export * from './check/log.js';
export * from './check/pdf.js';
export * from './check/source.js';
export * from './check/resume.js';
