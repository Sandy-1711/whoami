// DeepSeek transport. Like ./gemini.ts, this module knows nothing about résumés
// — it is the single place that talks to DeepSeek's OpenAI-compatible chat API.
// DeepSeek has no server-side JSON-schema enforcement, so we use its JSON mode
// (response_format json_object) and embed the expected schema in the prompt.
import type { JsonSchema } from './prompts.js';

const ENDPOINT = 'https://api.deepseek.com/chat/completions';

export interface DeepseekJsonArgs {
  prompt: string;
  schema: JsonSchema;
  apiKey: string;
  model: string;
  temperature?: number;
}

// Core call: prompt + JSON schema -> parsed object. Mirrors geminiJson's contract
// so the dispatcher in ./llm.ts can swap providers with no caller changes.
export async function deepseekJson<T = unknown>({
  prompt,
  schema,
  apiKey,
  model,
  temperature = 0.3,
}: DeepseekJsonArgs): Promise<T> {
  // JSON mode requires the word "json" in the prompt and gives no schema
  // guarantee, so we spell out the shape we want back.
  const guided = `${prompt}\n\nReturn ONLY a JSON object (no markdown, no prose) matching this schema:\n${JSON.stringify(schema)}`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
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
