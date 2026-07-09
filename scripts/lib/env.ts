// Single place that loads .env (quietly) and exposes the settings the tools
// read. Importing this module anywhere guarantees .env is loaded first.
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

export const env = {
  get geminiKey(): string { return process.env.GEMINI_API_KEY || ''; },
  get geminiModel(): string { return process.env.GEMINI_MODEL || 'gemini-2.5-flash'; },
  get deepseekKey(): string { return process.env.DEEPSEEK_API_KEY || ''; },
  get deepseekModel(): string { return process.env.DEEPSEEK_MODEL || 'deepseek-chat'; },
  // Default LLM provider: explicit LLM_PROVIDER wins; otherwise pick whichever
  // key is configured (Gemini first). Falls back to 'gemini' so error messages
  // point at the primary provider when nothing is set.
  get llmProvider(): 'gemini' | 'deepseek' {
    const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
    if (explicit === 'gemini' || explicit === 'deepseek') return explicit;
    if (process.env.GEMINI_API_KEY) return 'gemini';
    if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
    return 'gemini';
  },
  get githubToken(): string { return process.env.GITHUB_TOKEN || ''; },
  get linkedinCookie(): string { return process.env.LINKEDIN_COOKIE || ''; },
  get scrapeTtlHours(): number { return Number(process.env.SCRAPE_TTL_HOURS) || 12; },
};
