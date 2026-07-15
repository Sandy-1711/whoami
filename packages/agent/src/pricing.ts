// Chat-model catalog: the models the chat loop can switch between, plus the two
// numbers the CLI needs to show cost + context status — a context-window size
// and an approximate USD price. Prices are public list prices (USD per 1M
// tokens) as of early 2026 and are ESTIMATES for local display only; treat them
// as ballpark, not billing. Update here when a provider changes pricing.
import type { AgentProviderId } from './model.js';

export interface ChatModelInfo {
  providerId: AgentProviderId;
  modelId: string;
  label: string;
  contextWindow: number; // input token capacity, used for the "context used %" gauge
  inputPer1M: number;    // USD per 1M input (prompt) tokens
  outputPer1M: number;   // USD per 1M output (completion) tokens
}

// Ordered fastest/cheapest → most capable so `/model` reads naturally.
export const CHAT_MODELS: ChatModelInfo[] = [
  { providerId: 'gemini',   modelId: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', contextWindow: 1_048_576, inputPer1M: 0.10, outputPer1M: 0.40 },
  { providerId: 'gemini',   modelId: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',      contextWindow: 1_048_576, inputPer1M: 0.30, outputPer1M: 2.50 },
  { providerId: 'gemini',   modelId: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro',        contextWindow: 1_048_576, inputPer1M: 1.25, outputPer1M: 10.00 },
  { providerId: 'deepseek', modelId: 'deepseek-chat',         label: 'DeepSeek Chat',         contextWindow: 131_072,   inputPer1M: 0.27, outputPer1M: 1.10 },
];

// Look up a model's info by id. Falls back to a neutral entry (1M context, zero
// price) so an unknown/custom AGENT_MODEL still renders without crashing — the
// gauge and cost just read as best-effort.
export function chatModelInfo(modelId: string, providerId: AgentProviderId): ChatModelInfo {
  return (
    CHAT_MODELS.find((m) => m.modelId === modelId)
    ?? { providerId, modelId, label: modelId, contextWindow: providerId === 'deepseek' ? 131_072 : 1_048_576, inputPer1M: 0, outputPer1M: 0 }
  );
}

// Estimated USD cost of a turn/session given token counts.
export function estimateCost(info: ChatModelInfo, inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1e6) * info.inputPer1M + (outputTokens / 1e6) * info.outputPer1M;
}
