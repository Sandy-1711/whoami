// The studio's container. It is the CLI's `Cli` plus the two things a long-lived
// server owns that a one-shot command does not: the open memory store and the
// tracing pipeline, both built once and handed to every turn's agent, and the
// registries holding the questions currently waiting on a browser.
import { buildMemory, buildObservability, type AgentMemory, type UserAnswer } from '@resume/agent';
import type { Cli } from '@resume/cli';
import { PendingRequests } from './pending.js';

export interface Studio {
  cli: Cli;
  memory: AgentMemory;
  /** Undefined when Langfuse is off. Reused across turns — one exporter, one batch timer. */
  observability: ReturnType<typeof buildObservability>;
  confirms: PendingRequests<boolean>;
  asks: PendingRequests<UserAnswer[] | null>;
}

export function createStudio(cli: Cli): Studio {
  return {
    cli,
    memory: buildMemory(cli.root, cli.config),
    observability: buildObservability(cli.config),
    confirms: new PendingRequests(),
    asks: new PendingRequests(),
  };
}
