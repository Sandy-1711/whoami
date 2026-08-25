// Config adapter — loads .env from the repo root (not the CLI package dir) and
// builds the typed AppConfig the domain consumes. Core never reads process.env.
import { join } from 'node:path';
import dotenv from 'dotenv';
import type { AppConfig } from '@resume/core';
import { listProviders } from '@resume/llm';
import { repoRoot } from '../paths.js';

dotenv.config({ path: join(repoRoot, '.env'), quiet: true });

export function loadConfig(): AppConfig {
  const keys: Record<string, string> = {};
  const models: Record<string, string> = {};
  for (const provider of listProviders()) {
    keys[provider.id] = process.env[provider.apiKeyEnv] || '';
    models[provider.id] = process.env[provider.modelEnv] || '';
  }
  return {
    llm: {
      provider: (process.env.LLM_PROVIDER || '').toLowerCase(),
      keys,
      models,
      timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 0,
    },
    gmail: {
      user: process.env.GMAIL_USER || '',
      appPassword: process.env.GMAIL_APP_PASSWORD || '',
    },
    githubToken: process.env.GITHUB_TOKEN || '',
    linkedinCookie: process.env.LINKEDIN_COOKIE || '',
    scrapeTtlHours: Number(process.env.SCRAPE_TTL_HOURS) || 12,
    langfuse: {
      enabled: /^(1|true|yes)$/i.test(process.env.LANGFUSE_ENABLED || ''),
      publicKey: process.env.LANGFUSE_PUBLIC_KEY || '',
      secretKey: process.env.LANGFUSE_SECRET_KEY || '',
      baseUrl: process.env.LANGFUSE_BASE_URL || '',
    },
    agent: {
      provider: (process.env.AGENT_PROVIDER || '').toLowerCase(),
      model: process.env.AGENT_MODEL || '',
      embeddingModel: process.env.AGENT_EMBEDDING_MODEL || '',
      recall: /^(1|true|yes)$/i.test(process.env.AGENT_RECALL || ''),
      titleModel: process.env.AGENT_TITLE_MODEL || '',
    },
  };
}
