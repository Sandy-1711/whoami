// One chat turn, streamed to one browser.
//
// The deps are built per turn rather than per server because the presenter and
// the two gates belong to *this* stream — a confirm modal has to appear in the
// tab that asked for it. Memory and tracing are the studio's and are handed in,
// so rebuilding costs an Agent object and nothing else.
import {
  buildAgent, progressPresenter, AGENT_RESOURCE_ID, type AgentDeps,
} from '@resume/agent';
import { havePlaywright } from '@resume/cli';
import { browserAsk, browserConfirm } from './gates.js';
import { relay, type StreamChunk } from './relay.js';
import type { EventSink } from './sink.js';
import type { Studio } from './studio.js';
import type { TurnUsage } from '../shared/events.js';

// Matches the chat REPL's ceiling: enough steps for a scrape → plan → render
// chain, low enough that a loop cannot run unbounded.
const MAX_STEPS = 16;

export interface TurnRequest {
  message: string;
  threadId: string;
  /** Aborted when the browser hangs up, so a closed tab stops the run it started. */
  signal?: AbortSignal;
}

function turnDeps(studio: Studio, sink: EventSink): AgentDeps {
  const { cli } = studio;
  return {
    root: cli.root,
    config: cli.config,
    llm: cli.llm,
    latex: cli.latex,
    pdf: cli.pdf,
    mailer: cli.mailer,
    presenter: progressPresenter((line) => sink.send({ type: 'progress', line })),
    confirm: browserConfirm(studio.confirms, sink),
    ask: browserAsk(studio.asks, sink),
    playwright: havePlaywright(cli.root),
  };
}

export async function runTurn(studio: Studio, request: TurnRequest, sink: EventSink): Promise<void> {
  const { message, threadId, signal } = request;
  const built = buildAgent(turnDeps(studio, sink), {
    memory: studio.memory,
    observability: studio.observability,
  });

  const usage: TurnUsage = { inputTokens: 0, outputTokens: 0 };

  try {
    const res = await built.agent.stream(message, {
      memory: { thread: threadId, resource: AGENT_RESOURCE_ID },
      maxSteps: MAX_STEPS,
      abortSignal: signal,
      // Ask Gemini to stream its thought summaries so the reasoning pane fills
      // live. Namespaced under `google`, so other providers ignore it.
      providerOptions: { google: { thinkingConfig: { includeThoughts: true } } },
    });

    Object.assign(usage, await relay(res.fullStream as AsyncIterable<StreamChunk>, sink));
  } catch (err) {
    // A cancelled turn is not a failure to report; the browser asked for it.
    if (!signal?.aborted) sink.send({ type: 'error', message: (err as Error).message });
  }

  sink.send({ type: 'done', threadId, usage });
  await sink.drain();
}
