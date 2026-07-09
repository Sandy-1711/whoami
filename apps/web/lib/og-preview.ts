// Social/link-unfurl preview. When a crawler (Slack, LinkedIn, Twitter, …)
// fetches the résumé URL it wants HTML with OpenGraph tags, not the PDF bytes.
// The handler detects those bots with isCrawler() and serves buildPreviewHtml()
// instead — kept out of the handler so it stays readable.

const OG_TITLE = 'Sandeep Singh — AI Engineer';
const OG_DESC =
  'AI Engineer building agentic LLM systems, memory, and RAG. Shipped production ' +
  'agents at AiRA, fine-tuned multimodal LLMs to 75% accuracy, and built a solo app ' +
  'with 10,000+ downloads.';
const OG_IMAGE_W = 1200;
const OG_IMAGE_H = 630;

const CRAWLER_UA =
  /facebookexternalhit|Facebot|Twitterbot|Slackbot|Slack-ImgProxy|LinkedInBot|WhatsApp|TelegramBot|Discordbot|Pinterest|redditbot|Applebot|vkShare|SkypeUriPreview|Iframely|embedly|nuzzel|Qwantify|W3C_Validator/i;

export function isCrawler(userAgent: string | undefined): boolean {
  return CRAWLER_UA.test(userAgent || '');
}

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function buildPreviewHtml(origin: string): string {
  const url = `${origin}/`;
  const image = `${origin}/og.jpg`;

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
