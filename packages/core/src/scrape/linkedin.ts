// LinkedIn scraper. LinkedIn has no open API and actively blocks automation, so
// this prefers the safe, complete source and only automates as a last resort:
//
//   1. PDF (preferred): parse the Linkedin_Profile.pdf export in the repo root —
//      the full profile, and it touches no LinkedIn servers (no automation, no
//      account-ban risk).
//   2. LIVE (fallback, opt-in): only when no PDF is present — if LINKEDIN_COOKIE
//      (your `li_at` session cookie) is set and Playwright is installed, render
//      your own profile page and pull the visible text.
//
// Either way the raw text is structured into clean JSON by Gemini and written to
// profile/linkedin.json — an editable source of truth you can hand-correct.
//
// The LIVE path is DEPRECATED and no front end offers it any more (see
// LINKEDIN_LIVE_DEPRECATED). The code stays because the PDF path shares it and
// because turning it back on should be a decision, not a rewrite.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractPdf } from '../check/pdf.js';
import type { Llm } from '@resume/llm';
import { linkedinPrompt, LINKEDIN_SCHEMA, type LinkedinResponse } from '../prompts.js';
import type { LinkedinData } from '../types.js';

/**
 * Why the live LinkedIn scrape is no longer offered. The committed
 * profile/linkedin.json is still read; only re-scraping is off.
 */
export const LINKEDIN_LIVE_DEPRECATED =
  'The live LinkedIn scrape is deprecated — it automates a site against its terms using your own '
  + 'session cookie, and the downside is your account. profile/linkedin.json stays in use; refresh it '
  + 'by exporting Linkedin_Profile.pdf to the repo root, or by editing the JSON directly.';

// Try to render the live profile with Playwright + the session cookie. Throws a
// descriptive error (Playwright missing, login wall, timeout) so the caller can
// fall back to the PDF.
async function liveText({ cookie, url }: { cookie: string; url: string }): Promise<string> {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright not installed — run `npm i -D playwright && npx playwright install chromium` to enable live scraping.');
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    });
    await ctx.addCookies([{ name: 'li_at', value: cookie, domain: '.linkedin.com', path: '/' }]);
    const page = await ctx.newPage();
    const base = url.replace(/\/+$/, '');
    const grab = (): Promise<string> =>
      // Runs in the browser context; `document` is a browser global, so reach it
      // through globalThis to avoid pulling the DOM lib into this Node project.
      page.evaluate(() => {
        const d = (globalThis as any).document;
        return d.querySelector('main')?.innerText || d.body.innerText;
      });

    // The overview page lazy-loads only a few roles; the /details/* pages list
    // the full history. Collect the overview first, then append each detail page.
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    if (/\/(login|checkpoint|authwall)/.test(page.url())) {
      throw new Error('LinkedIn redirected to a login/checkpoint wall — the li_at cookie is expired or invalid.');
    }
    let text = await grab();
    for (const section of ['experience', 'education', 'skills', 'certifications']) {
      try {
        await page.goto(`${base}/details/${section}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
        if (/\/(login|checkpoint|authwall)/.test(page.url())) continue;
        text += `\n\n=== ${section.toUpperCase()} ===\n` + (await grab());
      } catch { /* a missing detail page is fine — keep what we have */ }
    }
    if (!text || text.length < 200) throw new Error('Live page returned too little text (likely blocked).');
    return text;
  } finally {
    await browser.close();
  }
}

async function pdfText(root: string): Promise<string> {
  const pdf = join(root, 'Linkedin_Profile.pdf');
  if (!existsSync(pdf)) {
    throw new Error('No live scrape and no Linkedin_Profile.pdf in the repo root — export your profile ("Save to PDF") and drop it there.');
  }
  const { text } = await extractPdf(pdf);
  return text;
}

interface RawProfile {
  via: 'live' | 'pdf';
  text: string;
}

// Prefer the offline PDF export when present: it's the complete profile and hits
// no LinkedIn servers (no automation, no ban risk). The live cookie scrape is a
// fallback used only when no PDF has been dropped in the repo root.
async function rawProfileText(root: string, { cookie, url }: { cookie: string; url: string }): Promise<RawProfile> {
  if (existsSync(join(root, 'Linkedin_Profile.pdf'))) {
    return { via: 'pdf', text: await pdfText(root) };
  }
  if (cookie && url) {
    return { via: 'live', text: await liveText({ cookie, url }) };
  }
  // No PDF and no live config — pdfText throws the actionable "export your
  // profile to PDF and drop it in the repo root" guidance.
  return { via: 'pdf', text: await pdfText(root) };
}

export interface ScrapeLinkedinOptions {
  cookie?: string;
  url?: string;
  llm?: Llm;
}

export async function scrapeLinkedin(
  root: string,
  { cookie = '', url = '', llm }: ScrapeLinkedinOptions = {},
): Promise<LinkedinData> {
  if (!llm) throw new Error('An LLM API key is required to structure the LinkedIn profile.');

  const { via, text } = await rawProfileText(root, { cookie, url });

  const { object: profile } = await llm.generateJson({
    operation: 'linkedin-structure',
    prompt: linkedinPrompt(text),
    schema: LINKEDIN_SCHEMA,
    temperature: 0.1,
  });

  return {
    _comment: 'Auto-scraped from LinkedIn (PDF export preferred, else live cookie scrape), structured by an LLM. Edit freely — the tailor treats this as an editable source. Re-scrape with `npm run sync -- --linkedin`.',
    scrapedAt: new Date().toISOString(),
    via,
    profileUrl: url || '',
    profile,
  };
}
