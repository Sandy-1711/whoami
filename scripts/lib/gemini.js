// Gemini engine: given the JD, the fact base, and the deterministically-computed
// keyword gaps, write a compelling tailored summary + subtitle — using ONLY
// facts the user can truthfully claim. Scoring stays in tailor-core (not the LLM)
// so numbers are reproducible; the model only handles phrasing.
const ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const SCHEMA = {
  type: 'object',
  properties: {
    role_title: { type: 'string' },
    tailored_summary_text: { type: 'string' },
    tailored_subtitle: { type: 'string' },
    bold_terms: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
  required: ['role_title', 'tailored_summary_text', 'tailored_subtitle', 'bold_terms', 'rationale'],
};

function prompt({ jd, facts, classification }) {
  return `You are an expert technical resume writer optimizing a resume for a specific job description (JD) and ATS keyword matching.

STRICT RULES:
- Use ONLY facts, skills, metrics, and keywords present in the FACT BASE. Never invent employers, numbers, or technologies.
- Prefer surfacing the "addable" keywords (things the candidate truly has but the current summary omits) that are relevant to this JD.
- Keep the summary to ONE sentence, ~<=320 characters, punchy, metric-led. Plain text only (no markdown, no LaTeX).
- The subtitle is a short " | "-separated tagline of 3 role/skill phrases matched to the JD.
- bold_terms: 3-6 exact substrings from your summary to bold (metrics and top keywords).
- role_title: the exact job title this JD is hiring for (e.g. "AI Dev Engineer", "Senior Backend Engineer"), copied/normalized from the JD. If the JD states no clear title, use "Software Engineer". Keep it under 50 characters, no company name, no location.

JOB DESCRIPTION:
"""${jd.slice(0, 6000)}"""

FACT BASE (the only truth you may use):
"""${JSON.stringify(facts).slice(0, 12000)}"""

KEYWORD ANALYSIS (already computed):
- JD keywords the resume already covers: ${classification.matched.join(', ') || '(none)'}
- TRUE keywords to surface (addable): ${classification.addable.join(', ') || '(none)'}
- JD keywords the candidate lacks (do NOT claim these): ${classification.missing.join(', ') || '(none)'}

Return JSON only.`;
}

export async function tailorWithGemini({ jd, facts, classification, apiKey, model }) {
  const res = await fetch(`${ENDPOINT(model)}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt({ jd, facts, classification }) }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content (check quota/safety blocks).');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini did not return valid JSON.');
  }
  return {
    roleTitle: parsed.role_title || '',
    summaryText: parsed.tailored_summary_text,
    subtitle: parsed.tailored_subtitle,
    boldTerms: parsed.bold_terms || [],
    rationale: parsed.rationale || '',
  };
}
