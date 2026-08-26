// The chat turn and the two answers that come back mid-turn.
//
// POST /api/chat holds an SSE stream open for the length of one turn. The
// confirm and ask replies arrive on ordinary POSTs — a second request settling a
// promise the first one is still awaiting, which is why the registries live on
// the studio rather than in the stream handler.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { UserAnswer } from '@resume/agent';
import { sseSink } from '../sink.js';
import { runTurn } from '../turn.js';
import type { Studio } from '../studio.js';

export function chatRoutes(studio: Studio): Hono {
  const app = new Hono();

  app.post('/chat', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const message = String(body.message ?? '').trim();
    const threadId = String(body.threadId ?? '').trim();
    if (!message) return c.json({ error: 'A turn needs a message.' }, 400);
    if (!threadId) return c.json({ error: 'A turn needs a threadId.' }, 400);

    return streamSSE(c, async (stream) => {
      const sink = sseSink(stream);
      // A browser that navigates away mid-turn leaves gates parked with nothing
      // to answer them; refusing is the only safe reading of that silence.
      stream.onAbort(() => {
        studio.confirms.abandon(false);
        studio.asks.abandon(null);
      });
      await runTurn(studio, { message, threadId }, sink);
    });
  });

  app.post('/confirm/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const settled = studio.confirms.settle(c.req.param('id'), body.approved === true);
    return settled ? c.json({ settled }) : c.json({ error: 'No confirmation is waiting under that id.' }, 404);
  });

  app.post('/ask/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const answers: UserAnswer[] = Array.isArray(body.answers)
      ? body.answers.map((a: { id?: unknown; answer?: unknown }) => ({
          id: String(a?.id ?? ''),
          answer: String(a?.answer ?? ''),
        }))
      : [];
    const settled = studio.asks.settle(c.req.param('id'), answers);
    return settled ? c.json({ settled }) : c.json({ error: 'No question is waiting under that id.' }, 404);
  });

  return app;
}
