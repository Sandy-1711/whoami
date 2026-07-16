// The agent's persistent memory, backed by libSQL on disk under .agent/.
//
// Three layers, all scoped to the single resource 'sandeep':
//  - thread + message storage (conversation history across sessions),
//  - working memory: a structured scratchpad of active applications, pending
//    manual actions, and preferences the agent keeps current,
//  - semantic recall: embeddings of past messages for "what did we decide about
//    X?" — OPT-IN via AGENT_RECALL=1 (and needs a Gemini key for embeddings).
//    It embeds every user message via Gemini's API *before* the chat model is
//    even called, so it costs a network round-trip per turn; off by default.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Memory } from '@mastra/memory';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import type { AppConfig } from '@resume/core';
import { resolveAgentEmbedder, resolveTitleModel } from './model.js';

// Everything memory-related is filed under one user id.
export const AGENT_RESOURCE_ID = 'sandeep';

// The working-memory scaffold the agent fills in and revises over time. Markdown
// so it's human-readable in the DB and easy for the model to update in place.
const WORKING_MEMORY_TEMPLATE = `# Job search — working memory

## Positioning
- Target roles:
- Current focus:

## Active applications
| Company | Role | Channel | Status | Next step |
|---|---|---|---|---|

## Pending manual actions
-

## Preferences & constraints
-
`;

export interface AgentMemory {
  memory: Memory;
  semanticRecall: boolean;   // whether embeddings-based recall is active
  dbPath: string;
}

// Build the memory instance. Always gets storage + working memory + recent
// history; adds semantic recall when embeddings are available.
export function buildMemory(root: string, config: AppConfig): AgentMemory {
  const dir = join(root, '.agent');
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'memory.db');
  const url = `file:${dbPath.replace(/\\/g, '/')}`;

  const storage = new LibSQLStore({ id: 'agent-memory', url });
  const embedder = config.agent?.recall ? resolveAgentEmbedder(config) : null;
  const titleModel = resolveTitleModel(config);

  const memory = new Memory({
    storage,
    // Same libSQL file also holds the vector index when recall is on.
    ...(embedder ? { vector: new LibSQLVector({ id: 'agent-vector', url }) } : {}),
    // AI SDK google v4 returns an EmbeddingModelV4; Mastra's type union lags at
    // V2/V3 but accepts it at runtime, so bridge the type here.
    ...(embedder ? { embedder: embedder.model as unknown as string } : {}),
    options: {
      lastMessages: 20,
      semanticRecall: embedder ? { topK: 4, messageRange: 2, scope: 'resource' } : false,
      workingMemory: { enabled: true, scope: 'resource', template: WORKING_MEMORY_TEMPLATE },
      // Titles are an extra LLM call — route it to the cheapest fast model
      // instead of the main chat model (same type bridge as the embedder).
      generateTitle: titleModel
        ? {
            model: titleModel as unknown as string,
            instructions: 'A concise 3-6 word title for this conversation. No quotes, no punctuation at the end.',
          }
        : true,
    },
  });

  return { memory, semanticRecall: Boolean(embedder), dbPath };
}
