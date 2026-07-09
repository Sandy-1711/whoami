// Gemini provider adapter. Talks to the Generative Language API through the
// injected HttpClient and implements the LlmProvider port. Knows nothing about
// résumés — prompts and schemas are passed in.
import type { HttpClient } from '../../ports/http.js';
import type {
  LlmProvider, LlmProviderConfig, LlmProviderFactory, LlmRequest,
} from '../../ports/llm.js';

const endpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

class GeminiProvider implements LlmProvider {
  readonly id = 'gemini';
  readonly label = 'Gemini';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly http: HttpClient,
  ) {}

  async generateJson<T = unknown>({ prompt, schema, temperature = 0.3 }: LlmRequest): Promise<T> {
    const res = await this.http.post(`${endpoint(this.model)}?key=${this.apiKey}`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini API ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned no content (check quota/safety blocks).');
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('Gemini did not return valid JSON.');
    }
  }
}

export const geminiFactory: LlmProviderFactory = {
  id: 'gemini',
  label: 'Gemini',
  apiKeyEnv: 'GEMINI_API_KEY',
  modelEnv: 'GEMINI_MODEL',
  defaultModel: 'gemini-2.5-flash',
  create({ apiKey, model, http }: LlmProviderConfig): LlmProvider {
    return new GeminiProvider(apiKey, model, http);
  },
};
