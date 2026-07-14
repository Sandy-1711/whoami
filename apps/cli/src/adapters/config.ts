// Config adapter — loads .env (from the repo root, not the CLI package dir) and
// builds the typed AppConfig the domain consumes. The per-provider API keys and
// model overrides are derived from the registered factories' declared env var
// names, so adding a provider needs no change here.
import { join } from 'node:path';
import dotenv from 'dotenv';
import type { AppConfig, LlmProviderFactory } from '@resume/core';
import { repoRoot } from '../paths.js';

dotenv.config({ path: join(repoRoot, '.env'), quiet: true });

export function loadConfig(factories: LlmProviderFactory[]): AppConfig {
  const keys: Record<string, string> = {};
  const models: Record<string, string> = {};
  for (const f of factories) {
    keys[f.id] = process.env[f.apiKeyEnv] || '';
    models[f.id] = (f.modelEnv && process.env[f.modelEnv]) || '';
  }
  return {
    llm: {
      provider: (process.env.LLM_PROVIDER || '').toLowerCase(),
      keys,
      models,
    },
    gmail: {
      user: process.env.GMAIL_USER || '',
      appPassword: process.env.GMAIL_APP_PASSWORD || '',
    },
    githubToken: process.env.GITHUB_TOKEN || '',
    linkedinCookie: process.env.LINKEDIN_COOKIE || '',
    scrapeTtlHours: Number(process.env.SCRAPE_TTL_HOURS) || 12,
    agent: {
      provider: (process.env.AGENT_PROVIDER || '').toLowerCase(),
      model: process.env.AGENT_MODEL || '',
      embeddingModel: process.env.AGENT_EMBEDDING_MODEL || '',
    },
  };
}
