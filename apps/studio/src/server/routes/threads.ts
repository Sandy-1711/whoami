// Past conversations, read straight out of the agent's libSQL memory — the same
// store `resume chat` resumes from, so a thread started in the terminal opens in
// the studio and the other way round.
import { Hono } from 'hono';
import { AGENT_RESOURCE_ID } from '@resume/agent';
import type { ThreadMessage } from '../../shared/events.js';
import type { Studio } from '../studio.js';

const THREAD_PAGE = 25;
const MESSAGE_PAGE = 200;

// A stored message is a list of parts (text, reasoning, tool invocations). The
// transcript only redraws what was said; the tool timeline is a live-turn view.
function flatten(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p): p is { type: string; text: string } =>
      Boolean(p) && (p as { type?: string }).type === 'text' && typeof (p as { text?: string }).text === 'string')
    .map((p) => p.text)
    .join('');
}

export function threadRoutes(studio: Studio): Hono {
  const app = new Hono();
  const { memory } = studio.memory;

  app.get('/threads', async (c) => {
    const { threads } = await memory.listThreads({
      filter: { resourceId: AGENT_RESOURCE_ID },
      orderBy: { field: 'updatedAt', direction: 'DESC' },
      perPage: THREAD_PAGE,
    });
    return c.json({
      threads: threads.map((t) => ({
        id: t.id,
        title: t.title || '(untitled)',
        updatedAt: new Date(t.updatedAt).toISOString(),
      })),
    });
  });

  app.get('/threads/:id', async (c) => {
    const threadId = c.req.param('id');
    const { messages } = await memory.recall({
      threadId,
      resourceId: AGENT_RESOURCE_ID,
      perPage: MESSAGE_PAGE,
      orderBy: { field: 'createdAt', direction: 'ASC' },
    });
    const transcript: ThreadMessage[] = messages
      .map((m) => ({
        id: m.id,
        role: m.role,
        text: flatten(m.content?.parts),
        createdAt: new Date(m.createdAt).toISOString(),
      }))
      .filter((m) => m.text.trim() !== '');
    return c.json({ threadId, messages: transcript });
  });

  return app;
}
