// Single place that loads .env (quietly) and exposes the settings the tools
// read. Importing this module anywhere guarantees .env is loaded first.
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

export const env = {
  get geminiKey(): string { return process.env.GEMINI_API_KEY || ''; },
  get geminiModel(): string { return process.env.GEMINI_MODEL || 'gemini-2.5-flash'; },
  get githubToken(): string { return process.env.GITHUB_TOKEN || ''; },
  get linkedinCookie(): string { return process.env.LINKEDIN_COOKIE || ''; },
  get scrapeTtlHours(): number { return Number(process.env.SCRAPE_TTL_HOURS) || 12; },
};
