// Tracing — one OpenTelemetry tracer for the whole toolkit, exported to a
// Langfuse instance. Everything here is built to disappear: with no provider
// registered the OTel API hands out non-recording spans, so `generate.ts` calls
// the same code whether tracing is on or off and pays nothing when it is off.
import { trace, type Tracer } from '@opentelemetry/api';

/**
 * Langfuse connection settings. Tracing stays off unless `enabled` is set and
 * both keys are present — a half-configured instance is treated as no instance.
 */
export interface TracingConfig {
  enabled: boolean;
  publicKey: string;
  secretKey: string;
  /** Base URL of the Langfuse instance; '' uses the local self-hosted default. */
  baseUrl: string;
}

/** A running export pipeline. `shutdown` flushes whatever is still buffered. */
export interface Tracing {
  shutdown(): Promise<void>;
}

const TRACER_NAME = '@resume/llm';

/** Where `pnpm langfuse:up` puts the web container. */
const DEFAULT_BASE_URL = 'http://localhost:3000';

/**
 * Longest a flush may delay process exit. Langfuse being unreachable must cost a
 * run a moment, not a hang, so the flush is raced against this and abandoned.
 */
const SHUTDOWN_TIMEOUT_MS = 5_000;

// Langfuse reads these off an OTel span to fill a generation's input, output and
// observation type. Spelled out here rather than imported from @langfuse/core so
// that a call site tagging a span pulls in nothing but @opentelemetry/api.
export const LANGFUSE_ATTR = {
  observationType: 'langfuse.observation.type',
  input: 'langfuse.observation.input',
  output: 'langfuse.observation.output',
  level: 'langfuse.observation.level',
  statusMessage: 'langfuse.observation.status_message',
  traceName: 'langfuse.trace.name',
} as const;

/**
 * The tracer every model call uses. Safe to call before — or without —
 * {@link startTracing}: the OTel API's default provider records nothing.
 */
export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

async function flush(shutdown: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
  });
  try {
    await Promise.race([shutdown().catch(() => {}), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Register the global tracer provider and start shipping spans to Langfuse.
 *
 * Returns null — and leaves the API's no-op provider in place — when tracing is
 * disabled, unconfigured, or fails to start. Nothing here throws: an
 * observability outage must never fail a résumé run. Failures are reported on
 * stderr, which stays clear of the MCP server's JSON-RPC stdout.
 */
export async function startTracing(config?: TracingConfig): Promise<Tracing | null> {
  if (!config?.enabled || !config.publicKey || !config.secretKey) return null;

  try {
    // Imported here so a run with tracing off never loads the Langfuse SDK.
    const [{ LangfuseSpanProcessor }, { BasicTracerProvider }] = await Promise.all([
      import('@langfuse/otel'),
      import('@opentelemetry/sdk-trace-base'),
    ]);

    const provider = new BasicTracerProvider({
      spanProcessors: [
        new LangfuseSpanProcessor({
          publicKey: config.publicKey,
          secretKey: config.secretKey,
          baseUrl: config.baseUrl || DEFAULT_BASE_URL,
        }),
      ],
    });
    trace.setGlobalTracerProvider(provider);

    return { shutdown: () => flush(() => provider.shutdown()) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`Langfuse tracing did not start (${detail}). Continuing untraced.`);
    return null;
  }
}
