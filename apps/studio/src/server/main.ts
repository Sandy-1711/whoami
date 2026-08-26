// The studio server. One process, one port: /api is Hono over the CLI's
// container, everything else is the SPA served by Vite in middleware mode — so
// there is no build step between editing a component and seeing it.
//
// It binds 127.0.0.1 and nothing else. The routes read and write the repo, spawn
// LaTeX, and reach a model on the operator's key; none of that belongs on a
// network interface.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { createServer as createViteServer } from 'vite';
import { buildCli } from '@resume/cli';
import { startTracing } from '@resume/llm';
import { createApp } from './app.js';
import { createStudio } from './studio.js';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4321;   // 3000 is the self-hosted Langfuse

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function port(argv: string[]): number {
  const i = argv.indexOf('--port');
  const value = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_PORT;
}

const cli = buildCli();
const studio = createStudio(cli);
// Pipeline spans buffer, so the flush has to outlive the turns that produced them.
const tracing = await startTracing(cli.config.langfuse);

const api = getRequestListener(createApp(studio).fetch);
const vite = await createViteServer({
  configFile: join(packageRoot, 'vite.config.ts'),
  root: join(packageRoot, 'src', 'web'),
  server: { middlewareMode: true },
});

const server = createServer((req, res) => {
  if (req.url?.startsWith('/api')) api(req, res);
  else vite.middlewares(req, res);
});

const listening = port(process.argv.slice(2));
server.listen(listening, HOST, () => {
  console.log(`résumé studio → http://${HOST}:${listening}`);
});

const shutdown = (): void => {
  server.close();
  void Promise.allSettled([
    vite.close(),
    tracing?.shutdown(),
    studio.observability?.shutdown(),
  ]).then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
