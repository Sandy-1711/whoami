// Composition root. The one place that instantiates concrete adapters, registers
// the LLM providers, and wires them into a Cli container the commands receive.
// Adding an LLM provider is a single `.register(...)` line here — nothing else in
// the CLI or core changes.
import {
  LlmProviderRegistry, geminiFactory, deepseekFactory, UnpdfInspector,
  type AppConfig, type LatexCompiler, type PdfInspector, type Presenter, type Mailer,
} from '@resume/core';
import { repoRoot } from './paths.js';
import { loadConfig } from './adapters/config.js';
import { NodeFetch } from './adapters/http.js';
import { DockerLatexCompiler } from './adapters/latex.js';
import { ClackPresenter } from './adapters/presenter.js';
import { GmailMailer } from './adapters/mailer.js';

export interface Cli {
  root: string;
  config: AppConfig;
  registry: LlmProviderRegistry;
  latex: LatexCompiler;
  pdf: PdfInspector;
  presenter: Presenter;
  mailer: Mailer;
}

export function buildCli(): Cli {
  const registry = new LlmProviderRegistry(new NodeFetch())
    .register(geminiFactory)
    .register(deepseekFactory);
  const config = loadConfig(registry.list());
  return {
    root: repoRoot,
    config,
    registry,
    latex: new DockerLatexCompiler(),
    pdf: new UnpdfInspector(),
    presenter: new ClackPresenter(),
    mailer: new GmailMailer(config.gmail.user, config.gmail.appPassword),
  };
}
