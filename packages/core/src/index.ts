// @resume/core public surface. The CLI and any other consumer import from here.

// Ports (the interfaces consumers implement or depend on).
export * from './ports/http.js';
export * from './ports/config.js';
export * from './ports/latex.js';
export * from './ports/logger.js';
export * from './ports/mailer.js';

// Domain types + pure helpers.
export * from './types.js';
export * from './format.js';
export * from './naming.js';
export * from './prompts.js';

// Tailoring.
export * from './tailor/core.js';
export * from './tailor/report.js';
export * from './tailor/service.js';

// Outreach copy (application-form note / cold email / LinkedIn DM / follow-up / referral ask).
export * from './outreach/service.js';

// Job-application email (draft + send via the Mailer port).
export * from './email/service.js';

// Profile sources + scraping.
export * from './profile/sources.js';
export * from './profile/status.js';
export * from './profile/facts-editor.js';
export * from './profile/curation.js';
export * from './profile/digest.js';
export * from './profile/loaders.js';
export * from './profile/serialize.js';

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
