// Past conversations, read straight out of the agent's libSQL memory — the same
// store `resume chat` resumes from, so a thread started in the terminal opens in
// the studio and the other way round.
import { Hono } from 'hono';
import { AGENT_RESOURCE_ID } from '@resume/agent';
import { hasContent, restoreMessage } from '../transcript.js';
import type { ThreadMessage } from '../../shared/events.js';
import type { Studio } from '../studio.js';

const THREAD_PAGE = 25;
const MESSAGE_PAGE = 200;

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
    const transcript: ThreadMessage[] = messages.map(restoreMessage).filter(hasContent);
    return c.json({ threadId, messages: transcript });
  });

  // Takes the messages with it and cannot be undone — the browser asks twice
  // before calling this. Deleting one that is already gone is not an error:
  // there is nothing left to go wrong about.
  app.delete('/threads/:id', async (c) => {
    const threadId = c.req.param('id');
    await memory.deleteThread(threadId);
    return c.json({ deleted: threadId });
  });

  return app;
}
