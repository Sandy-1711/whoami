// buildAgent — the composition point. Resolves the chat model, builds memory,
// assembles every tool group over the injected deps, and returns a ready Mastra
// Agent plus the metadata the CLI shows (which model, whether recall is on).
import { Agent } from '@mastra/core/agent';
import type { AgentDeps } from './deps.js';
import { resolveAgentModel } from './model.js';
import { buildMemory, type AgentMemory } from './memory.js';
import { RESUME_AGENT_INSTRUCTIONS } from './instructions.js';
import { readOnlyTools } from './tools/readonly.js';
import { pipelineTools } from './tools/pipeline.js';

export interface BuiltAgent {
  agent: Agent;
  model: { providerId: string; modelId: string; label: string };
  memory: AgentMemory;
}

export function buildAgent(deps: AgentDeps): BuiltAgent {
  const resolved = resolveAgentModel(deps.config);
  const mem = buildMemory(deps.root, deps.config);

  const tools = {
    ...readOnlyTools(deps),
    ...pipelineTools(deps),
  };

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
