// GET /api/status — the same report `resume status` prints, plus where the
// local Langfuse lives, so the SPA can link a turn out to its trace.
import { Hono } from 'hono';
import { collectStatus } from '@resume/core';
import { defaultProviderId, listProviders } from '@resume/llm';
import { havePlaywright, renderEngineReason } from '@resume/cli';
import type { Studio } from '../studio.js';

// Where `pnpm langfuse:up` puts the UI when LANGFUSE_BASE_URL says nothing.
const LANGFUSE_DEFAULT_URL = 'http://localhost:3000';

export function statusRoutes(studio: Studio): Hono {
  const app = new Hono();
  const { cli } = studio;

  app.get('/status', async (c) => {
    const report = await collectStatus({
      root: cli.root,
      config: cli.config,
      providers: listProviders(),
      activeProviderId: defaultProviderId(cli.config.llm),
      renderReason: renderEngineReason(),
      playwright: havePlaywright(cli.root),
    });
    const langfuse = cli.config.langfuse;
    return c.json({
      report,
      langfuse: {
        enabled: Boolean(langfuse?.enabled),
        url: langfuse?.baseUrl || LANGFUSE_DEFAULT_URL,
      },
    });
  });

  return app;
}
