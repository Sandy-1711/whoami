// buildAgent — the composition point. Resolves the chat model, builds memory,
// assembles every tool group over the injected deps, and returns a ready Mastra
// Agent plus the metadata the CLI shows (which model, whether recall is on).
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import type { Observability } from '@mastra/observability';
import type { AgentDeps } from './deps.js';
import { resolveAgentModel, type AgentModelOverride } from './model.js';
import { buildMemory, type AgentMemory } from './memory.js';
import { buildObservability } from './observability.js';
import { RESUME_AGENT_INSTRUCTIONS } from './instructions.js';
import { recordTools } from './recording.js';
import { readOnlyTools } from './tools/readonly.js';
import { askTools } from './tools/ask.js';
import { pipelineTools } from './tools/pipeline.js';
import { emailTools } from './tools/email.js';
import { factsTools } from './tools/facts.js';
import { githubTools } from './tools/github.js';
import { outreachTools } from './tools/outreach.js';
import { trackerTools } from './tools/tracker.js';

// The agent's id, also the key it is registered under on the Mastra container.
const AGENT_ID = 'resume-agent';

export interface BuiltAgent {
  agent: Agent;
  model: { providerId: string; modelId: string; label: string };
  memory: AgentMemory;
  // The container the agent is registered on. Holds the tracing pipeline, so a
  // caller that wants the last turn's trace to arrive flushes it before exiting.
  mastra: Mastra;
  // Undefined when Langfuse is off. Pass it back on a rebuild.
  observability?: Observability;
}

export interface BuildAgentOptions {
  // Runtime model pick from `/model`; overrides config/env resolution.
  modelOverride?: AgentModelOverride;
  // Reuse an already-open memory (e.g. when switching models mid-session) so we
  // don't reopen the libSQL store — the thread + working memory carry over.
  memory?: AgentMemory;
  // Reuse the tracing pipeline across a rebuild, for the same reason: a second
  // one would mean a second exporter shipping to the same Langfuse project.
  observability?: Observability;
}

// Every capability the toolkit exposes, as one Mastra tool map keyed by tool id.
// The single source of truth for "what tools exist" — the chat agent (buildAgent)
// and the MCP server (buildMcpServer) both wire exactly this set over the same
// injected deps, so the two front ends never drift apart.
//
// Wrapping the whole set in recordTools is what makes the history self-keeping:
// both front ends get it, and no tool (or model) has to opt in.
export function assembleTools(deps: AgentDeps) {
  return recordTools(deps.root, {
    ...readOnlyTools(deps),
    ...askTools(deps),
    ...pipelineTools(deps),
    ...emailTools(deps),
    ...factsTools(deps),
    ...githubTools(deps),
    ...outreachTools(deps),
    ...trackerTools(deps),
  });
}

export function buildAgent(deps: AgentDeps, opts: BuildAgentOptions = {}): BuiltAgent {
  const resolved = resolveAgentModel(deps.config, opts.modelOverride);
  const mem = opts.memory ?? buildMemory(deps.root, deps.config);
  const observability = opts.observability ?? buildObservability(deps.config);

  const tools = assembleTools(deps);

  const agent = new Agent({
    id: AGENT_ID,
    name: 'Résumé Agent',
    instructions: RESUME_AGENT_INSTRUCTIONS,
    model: resolved.model,
    tools,
    memory: mem.memory,
  });

  // Registering the agent on a Mastra container is what puts tracing behind it:
  // observability is a container-level concern, and the constructor wires this
  // instance into the agent it was handed.
  const mastra = new Mastra({ agents: { [AGENT_ID]: agent }, observability });

  return {
    agent,
    model: { providerId: resolved.providerId, modelId: resolved.modelId, label: resolved.label },
    memory: mem,
    mastra,
    observability,
  };
}
