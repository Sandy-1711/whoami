// @resume/agent — the Mastra-powered chat agent that wraps the résumé toolkit's
// capabilities as tools. Public surface is filled in as the agent is built.
export * from './model.js';
export * from './confirm.js';
export type { AgentDeps } from './deps.js';
export { progressPresenter, type ProgressSink } from './presenter.js';
export { readOnlyTools } from './tools/readonly.js';
export { pipelineTools } from './tools/pipeline.js';
