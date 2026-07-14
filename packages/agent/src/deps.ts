// AgentDeps — everything the tools need to do real work, injected once at
// agent-build time. It mirrors the CLI's `Cli` container (same concrete adapters
// are reused, NOT re-created) plus a confirm gate for irreversible actions and a
// Playwright flag for the status tool. Tools close over an AgentDeps; they never
// read process.env or construct adapters themselves.
import type {
  AppConfig, LlmProviderRegistry, LatexCompiler, PdfInspector, Mailer, Presenter, Embedder,
} from '@resume/core';
import type { ConfirmGate } from './confirm.js';

export interface AgentDeps {
  root: string;
  config: AppConfig;
  registry: LlmProviderRegistry;
  latex: LatexCompiler;
  pdf: PdfInspector;
  mailer: Mailer;
  presenter: Presenter;
  // Evidence-store embeddings (Gemini). Used by ingest_evidence; distinct from the
  // Mastra memory embedder wired inside memory.ts.
  embedder: Embedder;
  // Human-in-the-loop gate for irreversible/outward-facing actions (sending an
  // email, pushing to GitHub). The model cannot bypass it.
  confirm: ConfirmGate;
  // Whether Playwright is installed (LinkedIn live-scrape readiness) — a
  // node_modules probe the CLI does and passes in, so this package stays CLI-free.
  playwright: boolean;
}
