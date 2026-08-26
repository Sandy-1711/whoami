// @resume/cli's package entry: the composition root and the environment probes
// that go with it. `resume` itself runs from main.ts and never imports this —
// it exists so a second front end derives its deps from the same container
// rather than re-instantiating the adapters and drifting from it.
export { buildCli, type Cli } from './container.js';
export { renderEngineReason } from './adapters/latex.js';
export { havePlaywright } from './adapters/playwright.js';
export { repoRoot, buildPdfScript } from './paths.js';
