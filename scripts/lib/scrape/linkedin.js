// LinkedIn scraper. LinkedIn has no open API and actively blocks automation, so
// this does the pragmatic thing:
//
//   1. LIVE (preferred, opt-in): if LINKEDIN_COOKIE (your `li_at` session cookie)
//      is set and Playwright is installed, render your own profile page and pull
//      the visible text.
//   2. FALLBACK: parse the Linkedin_Profile.pdf export in the repo root.
//
// Either way the raw text is structured into clean JSON by Gemini and written to
// profile/linkedin.json — an editable source of truth you can hand-correct.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractPdf } from '../check/pdf.js';
import { geminiJson } from '../tailor/gemini.js';

const PROFILE_SCHEMA = {
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

// Try to render the live profile with Playwright + the session cookie. Throws a
// descriptive error (Playwright missing, login wall, timeout) so the caller can
// fall back to the PDF.
async function liveText({ cookie, url }) {
  let chromium;
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
    const grab = () => page.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText);

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

async function pdfText(root) {
  const pdf = join(root, 'Linkedin_Profile.pdf');
  if (!existsSync(pdf)) {
    throw new Error('No live scrape and no Linkedin_Profile.pdf in the repo root — export your profile ("Save to PDF") and drop it there.');
  }
  const { text } = await extractPdf(pdf);
  return text;
}

// Get raw profile text via live scrape (if configured) or the PDF export.
async function rawProfileText(root, { cookie, url }) {
  if (cookie && url) {
    try {
      return { via: 'live', text: await liveText({ cookie, url }) };
    } catch (err) {
      return { via: 'pdf', text: await pdfText(root), liveError: err.message };
    }
  }
  return { via: 'pdf', text: await pdfText(root) };
}

export async function scrapeLinkedin(root, { cookie, url, apiKey, model } = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY required to structure the LinkedIn profile.');

  const { via, text, liveError } = await rawProfileText(root, { cookie, url });

  const prompt = `Extract this LinkedIn profile into clean structured JSON. Use ONLY what appears in the text — do not invent roles, dates, or skills. Preserve exact company names, titles, and date ranges. Keep "about" concise.

PROFILE TEXT:
"""${String(text).slice(0, 18000)}"""

Return JSON matching the schema.`;

  const profile = await geminiJson({ prompt, schema: PROFILE_SCHEMA, apiKey, model, temperature: 0.1 });

  return {
    _comment: 'Auto-scraped from LinkedIn (live cookie scrape or PDF export), structured by Gemini. Edit freely — the tailor treats this as an editable source. Re-scrape with `npm run sync`.',
    scrapedAt: new Date().toISOString(),
    via,
    ...(liveError ? { liveError } : {}),
    profileUrl: url || '',
    profile,
  };
}
