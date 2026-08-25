// Composition root. The one place that instantiates concrete adapters and wires
// them into a Cli container the commands receive.
import {
  UnpdfInspector,
  type AppConfig, type LatexCompiler, type PdfInspector, type Presenter, type Mailer,
} from '@resume/core';
import { createLlm, type Llm } from '@resume/llm';
import { repoRoot } from './paths.js';
import { loadConfig } from './adapters/config.js';
import { DockerLatexCompiler } from './adapters/latex.js';
import { ClackPresenter } from './adapters/presenter.js';
import { GmailMailer } from './adapters/mailer.js';

export interface Cli {
  root: string;
  config: AppConfig;
  llm: Llm;
  latex: LatexCompiler;
  pdf: PdfInspector;
  presenter: Presenter;
  mailer: Mailer;
}

export function buildCli(): Cli {
  const config = loadConfig();
  return {
    root: repoRoot,
    config,
    llm: createLlm(config.llm),
    latex: new DockerLatexCompiler(),
    pdf: new UnpdfInspector(),
    presenter: new ClackPresenter(),
    mailer: new GmailMailer(config.gmail.user, config.gmail.appPassword),
  };
}
