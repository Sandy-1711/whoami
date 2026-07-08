// Every Gemini prompt template and response schema in the repo lives here, so
// the wording and the expected JSON shape can be reviewed and tuned in one file.
// This module is pure (no network, no I/O): it builds strings/objects and maps
// raw responses into typed results. The transport is ./gemini.ts.
import type { Facts, Classification, TailorContent, LinkedinProfile } from './types.js';

// A minimal subset of JSON Schema — the shape Gemini's responseSchema accepts.
export interface GeminiSchema {
  type: string;
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
}

// ---- résumé tailoring -------------------------------------------------------

export const TAILOR_SCHEMA: GeminiSchema = {
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

// Raw JSON shape Gemini returns for TAILOR_SCHEMA.
export interface TailorResponse {
  role_title?: string;
  tailored_summary_text: string;
  tailored_subtitle: string;
  bold_terms?: string[];
  rationale?: string;
}

export function tailorPrompt({
  jd,
  facts,
  classification,
}: {
  jd: string;
  facts: Facts;
  classification: Classification;
}): string {
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

// Normalize a raw tailor response into the shape the pipeline consumes.
export function mapTailorResponse(parsed: TailorResponse): TailorContent {
  return {
    roleTitle: parsed.role_title || '',
    summaryText: parsed.tailored_summary_text,
    subtitle: parsed.tailored_subtitle,
    boldTerms: parsed.bold_terms || [],
    rationale: parsed.rationale || '',
  };
}

// ---- LinkedIn profile structuring -------------------------------------------

export const LINKEDIN_SCHEMA: GeminiSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    headline: { type: 'string' },
    location: { type: 'string' },
    about: { type: 'string' },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          title: { type: 'string' },
          dates: { type: 'string' },
          location: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['company', 'title'],
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          school: { type: 'string' },
          degree: { type: 'string' },
          field: { type: 'string' },
          dates: { type: 'string' },
        },
        required: ['school'],
      },
    },
    skills: { type: 'array', items: { type: 'string' } },
    certifications: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'headline', 'experience', 'education', 'skills'],
};

// Gemini returns exactly a LinkedinProfile for LINKEDIN_SCHEMA.
export type LinkedinResponse = LinkedinProfile;

export function linkedinPrompt(text: string): string {
  return `Extract this LinkedIn profile into clean structured JSON. Use ONLY what appears in the text — do not invent roles, dates, or skills. Preserve exact company names, titles, and date ranges. Keep "about" concise.

PROFILE TEXT:
"""${String(text).slice(0, 18000)}"""

Return JSON matching the schema.`;
}
