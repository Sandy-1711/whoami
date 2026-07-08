import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { makeRedis } from '../lib/redis.js';

// null until a KV/Upstash store is connected. The resume still serves either
// way; views simply aren't counted until the store exists.
const redis = makeRedis();

// Load the compiled PDF once per cold start. CI compiles resume.tex and places
// the result at assets/resume.pdf; vercel.json's includeFiles bundles it here.
function loadPdf(): Buffer | null {
  const candidates = [
    fileURLToPath(new URL('../assets/resume.pdf', import.meta.url)),
    join(process.cwd(), 'assets', 'resume.pdf'),
  ];
  for (const path of candidates) {
    try {
      if (existsSync(path)) return readFileSync(path);
    } catch {
      // try the next candidate
    }
  }
  return null;
}
const pdf = loadPdf();

// The name browsers use when saving the file. Kept human-readable so a saved
// résumé is self-describing in someone's Downloads folder.
const DOWNLOAD_FILENAME = 'Sandeep Singh - AI Engineer.pdf';

// Open Graph metadata for link previews.
const OG_TITLE = 'Sandeep Singh — AI Engineer';
const OG_DESC =
  'AI Engineer building agentic LLM systems, memory, and RAG. Shipped production ' +
  'agents at AiRA, fine-tuned multimodal LLMs to 75% accuracy, and built a solo app ' +
  'with 10,000+ downloads.';
const OG_IMAGE_W = 1200;
const OG_IMAGE_H = 630;

// Social link-preview crawlers (unfurlers). General search engines are
// intentionally excluded so we never serve them different content than humans.
const CRAWLER_UA =
  /facebookexternalhit|Facebot|Twitterbot|Slackbot|Slack-ImgProxy|LinkedInBot|WhatsApp|TelegramBot|Discordbot|Pinterest|redditbot|Applebot|vkShare|SkypeUriPreview|Iframely|embedly|nuzzel|Qwantify|W3C_Validator/i;

function originFrom(req: VercelRequest): string {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'iamsandeep.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

// A minimal HTML page carrying the OG/Twitter tags. Served only to crawlers, so
// human visitors keep getting the PDF inline.
function buildPreviewHtml(origin: string): string {
  const url = `${origin}/`;
  const image = `${origin}/og.jpg`;
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(OG_TITLE)}</title>
<meta name="description" content="${esc(OG_DESC)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Sandeep Singh">
<meta property="og:title" content="${esc(OG_TITLE)}">
<meta property="og:description" content="${esc(OG_DESC)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:secure_url" content="${image}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="${OG_IMAGE_W}">
<meta property="og:image:height" content="${OG_IMAGE_H}">
<meta property="og:image:alt" content="${esc(OG_TITLE)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(OG_TITLE)}">
<meta name="twitter:description" content="${esc(OG_DESC)}">
<meta name="twitter:image" content="${image}">
</head>
<body>
<p><a href="${origin}/resume.pdf">View Sandeep Singh's résumé (PDF)</a></p>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Link-preview crawlers get HTML with OG tags (works even before the PDF is
  // built); everyone else gets the résumé itself.
  if (CRAWLER_UA.test((req.headers['user-agent'] as string) || '')) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.end(buildPreviewHtml(originFrom(req)));
    return;
  }

  if (!pdf) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Resume PDF has not been built yet. Run the CI pipeline to generate it.');
    return;
  }

  // Count the view, but never let a counter hiccup block the resume itself.
  if (redis) {
    try {
      await redis.incr('resume:views');
    } catch {
      // ignore — serving the PDF matters more than the count
    }
  }

  const download = !!(req.query && 'download' in req.query);
  res.setHeader('Content-Type', 'application/pdf');
  // Both forms: a quoted ASCII fallback and the RFC 5987 filename* so every
  // browser saves the file under the same readable name.
  const encoded = encodeURIComponent(DOWNLOAD_FILENAME);
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${DOWNLOAD_FILENAME}"; filename*=UTF-8''${encoded}`,
  );
  // Bypass the CDN cache so every open re-invokes this function and is counted.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.statusCode = 200;
  res.end(pdf);
}
