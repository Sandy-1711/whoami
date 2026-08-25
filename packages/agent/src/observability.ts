// Observability for the chat loop. Mastra attaches tracing at the container
// level, not the Agent — so this builds the entrypoint that `buildAgent` hands
// to its Mastra instance. The pipelines are traced separately, by the tracer in
// @resume/llm; both land in the same Langfuse project.
import { Observability } from '@mastra/observability';
import { LangfuseExporter } from '@mastra/langfuse';
import type { AppConfig } from '@resume/core';

/** Distinguishes chat traces from the pipelines' in the Langfuse UI. */
const SERVICE_NAME = 'resume-agent';

/**
 * Build the chat agent's Langfuse observability, or undefined when tracing is
 * off, unconfigured, or fails to construct — an observability outage must never
 * stop a chat session starting.
 *
 * Reuse the returned instance across rebuilds (a `/model` switch) rather than
 * calling this again; each one holds its own exporter and batch timer.
 */
export function buildObservability(config: AppConfig): Observability | undefined {
  const langfuse = config.langfuse;
  if (!langfuse?.enabled || !langfuse.publicKey || !langfuse.secretKey) return undefined;

  try {
    return new Observability({
      configs: {
        langfuse: {
          serviceName: SERVICE_NAME,
          exporters: [
            new LangfuseExporter({
              publicKey: langfuse.publicKey,
              secretKey: langfuse.secretKey,
              baseUrl: langfuse.baseUrl || undefined,
              // A chat turn is worth seeing while it is still being read, and
              // the batching a long-running server wants costs latency here.
              realtime: true,
            }),
          ],
        },
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`Langfuse tracing did not start for chat (${detail}). Continuing untraced.`);
    return undefined;
  }
}
