// Every LLM prompt template and response schema in the repo lives here, so the
// wording and the expected JSON shape can be reviewed and tuned in one file.
// This module is pure (no network, no I/O): it builds strings/objects and maps
// raw responses into typed results. The transport is any LlmProvider.
import type { JsonSchema } from './ports/llm.js';
import type { Facts, Classification, TailorContent, LinkedinProfile, WellfoundProfile, GithubData, LinkedinData } from './types.js';

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

// ---- job-application email --------------------------------------------------
// A full plain-text application email sent to a recruiter/hiring inbox. Unlike
// the Wellfound note it has a subject and a sign-off, and it references the
// attached résumé. Read by a human, so it optimizes for a reply, not keyword
// density. Draws only on the verified fact base. The contact-link signature is
// appended deterministically by the service, so the model must NOT invent links.

export const EMAIL_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    to: { type: 'string' },
    subject: { type: 'string' },
    body: { type: 'string' },
    rationale: { type: 'string' },
  },
  required: ['subject', 'body', 'rationale'],
};

// Raw JSON shape returned for EMAIL_SCHEMA.
export interface EmailResponse {
  // The apply-to address copied verbatim from the JD, or '' when none appears.
  to?: string;
  subject: string;
  body: string;
  rationale?: string;
}

export function emailPrompt({
  jd,
  company,
  role,
  facts,
  classification,
  candidateName,
  hasResume,
}: {
  jd: string;
  company: string;
  role: string;
  facts: Facts;
  classification: Classification;
  candidateName: string;
  // Whether a tailored résumé PDF is attached — changes whether the body may
  // reference "my attached résumé".
  hasResume: boolean;
}): string {
  return `You are helping a strong early-career engineer write a job-application email to a company's hiring inbox. A recruiter or founder reads it directly — optimize for a reply, not ATS keyword density.

GOAL: a concise, confident email (roughly 120-200 words in the body) that makes the reader want to open the résumé and respond.

STRICT RULES:
- Use ONLY facts, metrics, projects, and skills present in the FACT BASE. Never invent employers, numbers, technologies, or contact details.
- SUBJECT: short and specific. If the JD states an exact subject line to use (e.g. 'subject: "…"' or 'use the subject …'), copy it EXACTLY. Otherwise use "<Role> Application — <Candidate Name>".
- TO: if the JD contains an explicit apply-to email address, return it verbatim in "to". If none appears, return "" (empty) — do NOT guess an address.
- BODY: start with a greeting ("Hi <Company> team," — or "Hi there," if no company). Then 1-3 short paragraphs: open with the single most relevant proof point for THIS role (prefer a "matched"/"surface" keyword below, stated with its metric), then connect concretely to this company's product/stack/problem from the JD.
- ${hasResume ? 'A tailored résumé PDF is attached — you may refer to "my attached résumé" once, naturally.' : 'No résumé is attached — do NOT claim an attachment or say "attached".'}
- If the candidate is early-career relative to the ask, do NOT apologize or hedge — frame it as "already shipping in this exact stack, reviewed by maintainers".
- End the body with a sign-off line and the candidate's name exactly: "Best regards,\\n${candidateName}". Do NOT add phone numbers, emails, portfolio, GitHub, or LinkedIn links — a contact signature is appended automatically after your text.
- Plain text only. No markdown, no bullet characters, no subject/"To:" headers inside the body.

COMPANY: ${company || '(unknown — infer from the JD)'}
TARGET ROLE: ${role || '(infer from the JD)'}
CANDIDATE NAME: ${candidateName}

JOB DESCRIPTION:
"""${jd.slice(0, 6000)}"""

FACT BASE (the only truth you may use):
"""${JSON.stringify(facts).slice(0, 12000)}"""

KEYWORD ANALYSIS (already computed):
- Proven on the résumé (matched): ${classification.matched.join(', ') || '(none)'}
- TRUE & JD-relevant to emphasize (surface): ${classification.addable.join(', ') || '(none)'}
- JD wants but candidate lacks — NEVER claim: ${classification.missing.join(', ') || '(none)'}

Return JSON: { "to": apply-to email from the JD or "", "subject": the subject line, "body": the full email body ending in the sign-off + name, "rationale": 1-2 lines on why this framing works — for the candidate's eyes, NOT sent }.`;
}

// ---- Wellfound profile optimization -----------------------------------------
// Copy for the STANDING Wellfound profile — one profile shown for every role,
// like LinkedIn. JD-independent: it's built from the fact base (optionally
// focused toward a kind of role) and refined over time. Manual paste — Wellfound
// has no job-seeker API.

// Wellfound caps the bio field at 160 characters.
export const WELLFOUND_BIO_MAX = 160;

export const WELLFOUND_PROFILE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    bio: { type: 'string' },
    looking_for: { type: 'string' },
    achievements: { type: 'array', items: { type: 'string' } },
    skills: { type: 'array', items: { type: 'string' } },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          blurb: { type: 'string' },
        },
        required: ['label', 'blurb'],
      },
    },
    rationale: { type: 'string' },
  },
  required: ['headline', 'bio', 'looking_for', 'achievements', 'skills'],
};

// Raw JSON shape returned for WELLFOUND_PROFILE_SCHEMA.
export interface WellfoundProfileResponse {
  headline: string;
  bio: string;
  looking_for: string;
  achievements?: string[];
  skills?: string[];
  experience?: { label?: string; blurb?: string }[];
  rationale?: string;
}

export function wellfoundProfilePrompt({
  facts,
  target = '',
}: {
  facts: Facts;
  target?: string;
}): string {
  return `You are writing a candidate's STANDING Wellfound (AngelList Talent) profile — the single profile a startup founder sees for every role, like a LinkedIn profile. It is NOT tailored to one job. Optimize it to maximize relevant inbound: founders filter by role + skill tags and skim the headline and "what I'm looking for" line, so those must earn the click; then they read the about and experience.

STRICT RULES:
- Use ONLY the FACT BASE. Never invent employers, numbers, titles, or skills.
- headline: <= 60 characters — the role identity a founder searches for, optionally plus one metric. Align with title_variants (e.g. "AI Engineer — Agent Infrastructure"). No company name.
- bio: <= ${WELLFOUND_BIO_MAX} characters — HARD LIMIT (Wellfound's bio field is capped at ${WELLFOUND_BIO_MAX}). ONE punchy first-person line, metric-led, plain text. Lead with the single strongest proof (e.g. "12 merged PRs into Mastra's agent runtime"). Count the characters; it MUST be <= ${WELLFOUND_BIO_MAX}.
- looking_for: 1-2 sentences on the role / team / company stage the candidate wants (e.g. remote AI-engineering or agent-infrastructure work at an early-stage startup). Concrete, not a wish list.
- achievements: 4-6 short bullet lines for Wellfound's Achievements section, each metric-led and <= 120 chars, drawn ONLY from headline_metrics / experience highlights (e.g. "Merged 12 PRs into Mastra's agent runtime (25k+ stars)", "Fine-tuned Qwen 4B/8B to 75% accuracy"). This carries the proof that no longer fits in the short bio.
- skills: 12-18 skill tags ordered by relevance to the roles the candidate targets, each an EXACT token a founder would filter on (e.g. "TypeScript", "RAG", "LLM", "FastAPI", "React"). Most important first. Draw only from the fact base's skills/keywords.
- experience: for EACH experience entry and notable project in the fact base, one object: { "label": "<Org / Project — Role>", "blurb": "<2-3 sentence founder-facing description, outcome-first, drawn only from that entry's highlights/keywords>" }. Plain text, no markdown. This is the description the candidate pastes under each role on Wellfound.
- Keep it broad enough to attract a range of relevant AI-engineering / backend roles. If a TARGET FOCUS is given, lean the headline/bio/looking_for toward it, but do NOT narrow so far that other strong roles are excluded.

TARGET FOCUS (optional — may be empty):
"""${target.slice(0, 2000)}"""

FACT BASE (the only truth you may use):
"""${JSON.stringify(facts).slice(0, 14000)}"""

Return JSON matching the schema. "rationale" is 1-2 lines for the candidate on the positioning choices — not pasted into the profile.`;
}

// Hard-clamp the bio to Wellfound's limit at a word boundary — a safety net in
// case the model runs long despite the prompt's HARD LIMIT.
export function clampBio(s: string, max = WELLFOUND_BIO_MAX): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

// Normalize a raw Wellfound profile response into the domain shape.
export function mapWellfoundProfile(parsed: WellfoundProfileResponse): WellfoundProfile {
  return {
    headline: (parsed.headline || '').trim(),
    bio: clampBio(parsed.bio || ''),
    lookingFor: parsed.looking_for || '',
    achievements: (parsed.achievements || []).map((s) => String(s).trim()).filter(Boolean),
    skills: parsed.skills || [],
    experience: (parsed.experience || [])
      .filter((e) => e && (e.label || e.blurb))
      .map((e) => ({ label: (e.label || '').trim(), blurb: (e.blurb || '').trim() })),
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

// ---- profile enhancer (drift-lite) -----------------------------------------
// Compares the verified fact base against the CURRENTLY-LIVE surfaces (scraped
// LinkedIn + GitHub) and proposes paste-ready copy plus a list of what looks
// stale or missing. Grounded strictly in the fact base — it may rephrase facts
// but never invent them. The user pastes the results into LinkedIn/GitHub by hand.

export const ENHANCE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    linkedin_headline: { type: 'string' },
    linkedin_about: { type: 'string' },
    linkedin_skills_to_add: { type: 'array', items: { type: 'string' } },
    github_bio: { type: 'string' },
    stale_or_missing: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
  required: ['linkedin_headline', 'linkedin_about', 'linkedin_skills_to_add', 'github_bio', 'stale_or_missing'],
};

export interface EnhanceResponse {
  linkedin_headline: string;
  linkedin_about: string;
  linkedin_skills_to_add: string[];
  github_bio: string;
  stale_or_missing: string[];
  rationale?: string;
}

export function enhancePrompt({
  facts,
  linkedin,
  github,
  target,
}: {
  facts: Facts;
  linkedin: LinkedinData | null;
  github: GithubData | null;
  target: string;
}): string {
  // Only the fields that matter for surface copy, to keep the prompt lean.
  const li = linkedin?.profile
    ? { headline: linkedin.profile.headline, about: linkedin.profile.about, skills: linkedin.profile.skills }
    : null;
  const gh = github
    ? { bio: (github as unknown as { bio?: string }).bio ?? null, topRepos: (github.repos || []).filter((r) => !r.fork).slice(0, 8).map((r) => ({ name: r.name, description: r.description })) }
    : null;

  return `You keep a job-seeker's public profiles consistent with their VERIFIED fact base. Compare the current LinkedIn + GitHub surfaces to the fact base and propose better, truthful copy — plus flag what's stale or missing.

STRICT RULES:
- Ground everything in the FACT BASE. You may compress or rephrase real facts; NEVER invent employers, numbers, titles, or technologies.
- Refer to the Indigle/Samagra role as "Founding Software Engineer" — never "co-founder" or "CTO".
- linkedin_headline: one line, <= 220 chars, lead with the strongest positioning${target ? ` (focus: ${target})` : ''}.
- linkedin_about: 3-5 tight sentences, first person, metric-led, no clichés.
- linkedin_skills_to_add: skills that are TRUE (in the fact base) but missing from the current LinkedIn skills list.
- github_bio: <= 160 chars, punchy, current focus + strongest proof.
- stale_or_missing: concrete observations where a live surface contradicts or omits the fact base (e.g. "LinkedIn headline omits Mastra", "GitHub bio missing"). Each item one short line.

FACT BASE (the only truth you may use):
"""${JSON.stringify(facts).slice(0, 12000)}"""

CURRENT LINKEDIN (scraped):
"""${JSON.stringify(li).slice(0, 4000)}"""

CURRENT GITHUB (scraped):
"""${JSON.stringify(gh).slice(0, 4000)}"""

Return JSON only.`;
}

// ---- outreach (cold reach-out / DM / follow-up / referral) ------------------
// Short, human-to-human messages for reaching out on job boards, email, or
// LinkedIn. Grounded in the fact base; optionally anchored to a specific JD.

export type OutreachKind = 'cold_email' | 'linkedin_dm' | 'followup' | 'referral_ask';

export const OUTREACH_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    message: { type: 'string' },
    rationale: { type: 'string' },
  },
  required: ['message'],
};

export interface OutreachResponse {
  subject?: string;
  message: string;
  rationale?: string;
}

const OUTREACH_SPEC: Record<OutreachKind, { words: number; subject: boolean; brief: string }> = {
  cold_email: { words: 130, subject: true, brief: 'A cold email to a hiring manager or founder. Has a subject line. One clear ask (a quick chat or to be considered). Lead with the single most relevant proof point.' },
  linkedin_dm: { words: 60, subject: false, brief: 'A LinkedIn connection/DM note. Very short (LinkedIn caps ~300 chars). No subject. Warm, specific, one hook, one soft ask.' },
  followup: { words: 90, subject: true, brief: 'A polite follow-up after applying or an earlier message with no reply. Reference the prior touch, add one new proof point, restate the ask lightly. Not pushy.' },
  referral_ask: { words: 100, subject: false, brief: 'A message asking a contact (often a stranger who works there) for a referral. Make it easy: say why you fit in one line, attach nothing, offer your résumé/links.' },
};

export function outreachPrompt({
  kind,
  facts,
  company,
  role,
  jd,
  context,
}: {
  kind: OutreachKind;
  facts: Facts;
  company: string;
  role: string;
  jd: string;
  context: string;
}): string {
  const spec = OUTREACH_SPEC[kind];
  return `You write short, effective outreach messages for a strong early-career engineer's job search. A real person reads this — optimize for a reply, not keyword density.

MESSAGE TYPE: ${kind} — ${spec.brief}
LENGTH: about ${spec.words} words max.${spec.subject ? ' Include a short, specific subject line.' : ' No subject line (this is a DM).'}

STRICT RULES:
- Use ONLY facts, metrics, projects, and skills in the FACT BASE. Never invent employers, numbers, or technologies.
- Refer to the Indigle/Samagra role as "Founding Software Engineer" — never "co-founder" or "CTO".
- Be specific about THIS company/role — reference the real product area or stack. Generic enthusiasm fails.
- First person, confident, conversational. No clichés, no "I am passionate about". One sharp hook beats three adjectives.
- If early-career relative to the ask, frame it as "already shipping in this exact stack, reviewed by maintainers" — do not apologize.
- Plain text only. No markdown.

COMPANY: ${company || '(unspecified)'}
TARGET ROLE: ${role || '(unspecified)'}
${context ? `EXTRA CONTEXT (from the user): ${context}\n` : ''}${jd ? `JOB DESCRIPTION:\n"""${jd.slice(0, 4000)}"""\n` : ''}
FACT BASE (the only truth you may use):
"""${JSON.stringify(facts).slice(0, 12000)}"""

Return JSON: { ${spec.subject ? '"subject": the subject line, ' : ''}"message": the message to send, "rationale": 1-2 lines on why this framing works (for the candidate, not sent) }.`;
}
