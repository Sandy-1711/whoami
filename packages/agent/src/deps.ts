// AgentDeps — everything the tools need to do real work, injected once at
// agent-build time. It mirrors the CLI's `Cli` container (same concrete adapters
// are reused, NOT re-created) plus a confirm gate for irreversible actions and a
// Playwright flag for the status tool. Tools close over an AgentDeps; they never
// read process.env or construct adapters themselves.
import type {
  AppConfig, LatexCompiler, PdfInspector, Mailer, Presenter,
} from '@resume/core';
import type { Llm } from '@resume/llm';
import type { ConfirmGate, AskGate } from './confirm.js';

export interface AgentDeps {
  root: string;
  config: AppConfig;
  llm: Llm;
  latex: LatexCompiler;
  pdf: PdfInspector;
  mailer: Mailer;
  presenter: Presenter;
  // Human-in-the-loop gate for irreversible/outward-facing actions (sending an
  // email, pushing to GitHub). The model cannot bypass it.
  confirm: ConfirmGate;
  // Asks the user a question and returns the answer. Absent where no human is
  // reachable in-process (MCP): there the client is the one holding the
  // conversation, so ask_user hands the questions to it instead.
  ask?: AskGate;
  // Whether Playwright is installed (LinkedIn live-scrape readiness) — a
  // node_modules probe the CLI does and passes in, so this package stays CLI-free.
  playwright: boolean;
}
