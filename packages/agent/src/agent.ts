// buildAgent — the composition point. Resolves the chat model, builds memory,
// assembles every tool group over the injected deps, and returns a ready Mastra
// Agent plus the metadata the CLI shows (which model, whether recall is on).
import { Agent } from '@mastra/core/agent';
import type { AgentDeps } from './deps.js';
import { resolveAgentModel, type AgentModelOverride } from './model.js';
import { buildMemory, type AgentMemory } from './memory.js';
import { RESUME_AGENT_INSTRUCTIONS } from './instructions.js';
import { readOnlyTools } from './tools/readonly.js';
import { pipelineTools } from './tools/pipeline.js';
import { wellfoundTools } from './tools/wellfound.js';
import { emailTools } from './tools/email.js';
import { factsTools } from './tools/facts.js';
import { enhanceTools } from './tools/enhance.js';
import { githubTools } from './tools/github.js';
import { outreachTools } from './tools/outreach.js';
import { trackerTools } from './tools/tracker.js';

export interface BuiltAgent {
  agent: Agent;
  model: { providerId: string; modelId: string; label: string };
  memory: AgentMemory;
}

export interface BuildAgentOptions {
  // Runtime model pick from `/model`; overrides config/env resolution.
  modelOverride?: AgentModelOverride;
  // Reuse an already-open memory (e.g. when switching models mid-session) so we
  // don't reopen the libSQL store — the thread + working memory carry over.
  memory?: AgentMemory;
}

// Every capability the toolkit exposes, as one Mastra tool map keyed by tool id.
// The single source of truth for "what tools exist" — the chat agent (buildAgent)
// and the MCP server (buildMcpServer) both wire exactly this set over the same
// injected deps, so the two front ends never drift apart.
export function assembleTools(deps: AgentDeps) {
  return {
    ...readOnlyTools(deps),
    ...pipelineTools(deps),
    ...wellfoundTools(deps),
    ...emailTools(deps),
    ...factsTools(deps),
    ...enhanceTools(deps),
    ...githubTools(deps),
    ...outreachTools(deps),
    ...trackerTools(deps),
  };
}

export function buildAgent(deps: AgentDeps, opts: BuildAgentOptions = {}): BuiltAgent {
  const resolved = resolveAgentModel(deps.config, opts.modelOverride);
  const mem = opts.memory ?? buildMemory(deps.root, deps.config);

  const tools = assembleTools(deps);

  const agent = new Agent({
    id: 'resume-agent',
    name: 'Résumé Agent',
    instructions: RESUME_AGENT_INSTRUCTIONS,
    model: resolved.model,
    tools,
    memory: mem.memory,
  });

  return {
    agent,
    model: { providerId: resolved.providerId, modelId: resolved.modelId, label: resolved.label },
    memory: mem,
  };
}
