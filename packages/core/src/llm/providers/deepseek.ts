// DeepSeek provider adapter — OpenAI-compatible chat completions through the
// injected HttpClient. DeepSeek has no server-side JSON-schema enforcement, so
// it uses JSON mode (response_format json_object) and embeds the schema in the
// prompt. Implements the same LlmProvider port as every other provider.
import type { HttpClient } from '../../ports/http.js';
import type {
  LlmProvider, LlmProviderConfig, LlmProviderFactory, LlmRequest,
} from '../../ports/llm.js';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

class DeepseekProvider implements LlmProvider {
  readonly id = 'deepseek';
  readonly label = 'DeepSeek';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly http: HttpClient,
  ) {}

  async generateJson<T = unknown>({ prompt, schema, temperature = 0.3 }: LlmRequest): Promise<T> {
    // JSON mode requires the word "json" in the prompt and gives no schema
    // guarantee, so we spell out the shape we want back.
    const guided = `${prompt}\n\nReturn ONLY a JSON object (no markdown, no prose) matching this schema:\n${JSON.stringify(schema)}`;
    const res = await this.http.post(ENDPOINT, {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: guided }],
        temperature,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DeepSeek API ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as any;
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('DeepSeek returned no content (check quota/model name).');
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('DeepSeek did not return valid JSON.');
    }
  }
}

export const deepseekFactory: LlmProviderFactory = {
  id: 'deepseek',
  label: 'DeepSeek',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  modelEnv: 'DEEPSEEK_MODEL',
  defaultModel: 'deepseek-chat',
  create({ apiKey, model, http }: LlmProviderConfig): LlmProvider {
    return new DeepseekProvider(apiKey, model, http);
  },
};
