// Composition root. The one place that instantiates concrete adapters, registers
// the LLM providers, and wires them into a Cli container the commands receive.
// Adding an LLM provider is a single `.register(...)` line here — nothing else in
// the CLI or core changes.
import {
  LlmProviderRegistry, geminiFactory, deepseekFactory, UnpdfInspector,
  createGeminiEmbedder, GEMINI_EMBED_MODEL,
  type AppConfig, type LatexCompiler, type PdfInspector, type Presenter, type Mailer, type Embedder,
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
  // Evidence-store embeddings (Gemini, via the same HttpClient as the registry).
  // Distinct from the agent's Mastra memory embedder — this one is HttpClient-based.
  embedder: Embedder;
}

export function buildCli(): Cli {
  const http = new NodeFetch();
  const registry = new LlmProviderRegistry(http)
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
    embedder: createGeminiEmbedder({
      apiKey: config.llm.keys.gemini || '',
      model: config.agent?.embeddingModel || GEMINI_EMBED_MODEL,
      http,
    }),
  };
}
