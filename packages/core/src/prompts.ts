// Every LLM prompt template and response schema in the repo lives here, so the
// wording and the expected JSON shape can be reviewed and tuned in one file.
// This module is pure (no network, no I/O): it builds strings/objects and maps
// raw responses into typed results. The transport is any LlmProvider.
import type { JsonSchema } from './ports/llm.js';
import type { Facts, Classification, TailorContent, LinkedinProfile, WellfoundProfile } from './types.js';

// ---- résumé tailoring -------------------------------------------------------

export const TAILOR_SCHEMA: JsonSchema = {
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

// A retry prompt for the tighten-and-render loop: a previous draft made the
// one-page résumé fail a layout guard (usually spilling to a 2nd page), so ask
// for a shorter revision with a hard character budget while preserving the
// strongest JD-matched keywords and metrics.
export function tailorFixPrompt({
  jd,
  facts,
  classification,
  previous,
  problem,
  summaryBudget,
}: {
  jd: string;
  facts: Facts;
  classification: Classification;
  previous: { summaryText: string; subtitle: string };
  problem: string;
  summaryBudget: number;
}): string {
  return `You are an expert technical resume writer. A previous draft made the one-page résumé FAIL a layout guard. Produce a TIGHTER revision that fixes it.

LAYOUT PROBLEM TO FIX: ${problem}
The résumé MUST fit on exactly one page. Your previous draft was too long. Shorten aggressively while keeping the strongest JD-matched keywords and metrics.

STRICT RULES:
- Use ONLY facts, skills, metrics, and keywords present in the FACT BASE. Never invent employers, numbers, or technologies.
- Keep the summary to ONE sentence, <= ${summaryBudget} characters (shorter is better). Plain text only (no markdown, no LaTeX).
- The subtitle is a short " | "-separated tagline of AT MOST 3 short role/skill phrases.
- bold_terms: 3-5 exact substrings from your summary to bold (metrics and top keywords).
- role_title: keep the SAME job title as the previous draft.

PREVIOUS SUMMARY (too long): """${previous.summaryText}"""
PREVIOUS SUBTITLE (too long): """${previous.subtitle}"""

JOB DESCRIPTION:
"""${jd.slice(0, 6000)}"""

FACT BASE (the only truth you may use):
"""${JSON.stringify(facts).slice(0, 12000)}"""

KEYWORD PRIORITIES:
- Already covered: ${classification.matched.join(', ') || '(none)'}
- Surface if room: ${classification.addable.join(', ') || '(none)'}
- Do NOT claim: ${classification.missing.join(', ') || '(none)'}

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

// ---- Wellfound application message ------------------------------------------
// The short note that goes in Wellfound's "What interests you about this role?"
// box. It is read by a founder/hiring manager, not an ATS — so this optimizes
// for a reply, not keyword density. Draws only on the verified fact base.

export const WELLFOUND_MESSAGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    rationale: { type: 'string' },
  },
  required: ['message', 'rationale'],
};

// Raw JSON shape returned for WELLFOUND_MESSAGE_SCHEMA.
export interface WellfoundMessageResponse {
  message: string;
  rationale?: string;
}

export function wellfoundMessagePrompt({
  jd,
  company,
  role,
  facts,
  classification,
}: {
  jd: string;
  company: string;
  role: string;
  facts: Facts;
  classification: Classification;
}): string {
  return `You are helping a strong early-career engineer write the short intro note that goes in Wellfound's "What interests you about this role?" application box. A startup founder or hiring manager reads it directly — this is NOT parsed by an ATS, so optimize for a human reply, not keyword density.

GOAL: a 60-100 word note that makes the founder want to respond.

STRICT RULES:
- Use ONLY facts, metrics, projects, and skills present in the FACT BASE. Never invent employers, numbers, or technologies.
- Open with the single most relevant proof point for THIS role — prefer something the JD explicitly asks for (a "matched" or "surface" keyword below), stated with its metric.
- Say something concrete about why THIS company/role: reference the actual product area, stack, or problem from the JD. Generic enthusiasm is a fail.
- First person, confident, conversational. NO greeting line ("Hi", "Dear hiring manager") and NO sign-off/signature — Wellfound already shows the candidate's name and photo.
- No buzzword stuffing, no "I am passionate about", no clichés. One sharp hook beats three adjectives.
- If the candidate is early-career relative to the ask, do NOT apologize or hedge — frame it as "already shipping in this exact stack, reviewed by maintainers".
- Plain text only. One or two short paragraphs. No markdown, no bullet points.

COMPANY: ${company || '(unknown — infer from the JD)'}
TARGET ROLE: ${role || '(infer from the JD)'}

JOB DESCRIPTION:
"""${jd.slice(0, 6000)}"""

FACT BASE (the only truth you may use):
"""${JSON.stringify(facts).slice(0, 12000)}"""

KEYWORD ANALYSIS (already computed):
- Proven on the résumé (matched): ${classification.matched.join(', ') || '(none)'}
- TRUE & JD-relevant to emphasize (surface): ${classification.addable.join(', ') || '(none)'}
- JD wants but candidate lacks — NEVER claim: ${classification.missing.join(', ') || '(none)'}

Return JSON: { "message": the note to paste, "rationale": 1-2 lines on why this framing works — for the candidate's eyes, NOT pasted }.`;
}

// ---- Wellfound profile optimization -----------------------------------------
// Suggested copy for the standing Wellfound profile (headline / about / what
// I'm looking for / skill tags) so founders searching for talent surface and
// message the candidate. Manual paste — Wellfound has no job-seeker API.

export const WELLFOUND_PROFILE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    about: { type: 'string' },
    looking_for: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
  required: ['headline', 'about', 'looking_for', 'skills'],
};

// Raw JSON shape returned for WELLFOUND_PROFILE_SCHEMA.
export interface WellfoundProfileResponse {
  headline: string;
  about: string;
  looking_for: string;
  skills?: string[];
  rationale?: string;
}

export function wellfoundProfilePrompt({
  facts,
  target = '',
}: {
  facts: Facts;
  target?: string;
}): string {
  return `You are optimizing a candidate's Wellfound (AngelList Talent) profile so that startup founders searching for talent surface and message them. Founders filter by role + skill tags and skim the headline and "what I'm looking for" line, so those must earn the click.

STRICT RULES:
- Use ONLY the FACT BASE. Never invent employers, numbers, titles, or skills.
- headline: <= 60 characters — the role identity a founder searches for, optionally plus one metric. Align with title_variants (e.g. "AI Engineer — Agent Infrastructure"). No company name.
- about: 2-3 sentences, metric-led, first person, plain text. Lead with the strongest proof (merged OSS PRs into a well-known repo, production agents shipped, users scaled). No fluff, no "passionate about".
- looking_for: 1-2 sentences on the role / team / company stage the candidate wants (e.g. remote AI-engineering or agent-infrastructure work at an early-stage startup). Concrete, not a wish list.
- skills: 12-18 skill tags ordered by relevance to the roles the candidate targets, each an EXACT token founders would filter on (e.g. "TypeScript", "RAG", "LLM", "FastAPI", "React"). Most important first. Draw only from the fact base's skills/keywords.
- Bias emphasis toward the TARGET CONTEXT if given, but keep the profile broad enough to attract a range of relevant AI-engineering / backend roles — this is a standing profile, not a per-JD document.

TARGET CONTEXT (optional — may be empty):
"""${target.slice(0, 2000)}"""

FACT BASE (the only truth you may use):
"""${JSON.stringify(facts).slice(0, 12000)}"""

Return JSON matching the schema. "rationale" is 1-2 lines for the candidate on what changed and why — not pasted into the profile.`;
}

// Normalize a raw Wellfound profile response into the domain shape.
export function mapWellfoundProfile(parsed: WellfoundProfileResponse): WellfoundProfile {
  return {
    headline: parsed.headline || '',
    about: parsed.about || '',
    lookingFor: parsed.looking_for || '',
    skills: parsed.skills || [],
  };
}

// ---- LinkedIn profile structuring -------------------------------------------

export const LINKEDIN_SCHEMA: JsonSchema = {
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
