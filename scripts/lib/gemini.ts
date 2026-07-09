// Gemini transport. This module knows nothing about résumés — it is the single
// place that talks to the Generative Language API. Prompt templates and response
// schemas live in ./prompts.ts; callers pass them in.
import type { JsonSchema } from './prompts.js';

const ENDPOINT = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export interface GeminiJsonArgs {
  prompt: string;
  schema: JsonSchema;
  apiKey: string;
  model: string;
  temperature?: number;
}

// Core call: prompt + JSON schema -> parsed object. Shared by every Gemini use
// in this repo (tailoring, LinkedIn structuring) so the fetch/error handling
// lives in exactly one place.
export async function geminiJson<T = unknown>({
  prompt,
  schema,
  apiKey,
  model,
  temperature = 0.3,
}: GeminiJsonArgs): Promise<T> {
  const res = await fetch(`${ENDPOINT(model)}?key=${apiKey}`, {
    method: 'POST',
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
