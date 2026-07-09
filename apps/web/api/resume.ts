import type { VercelRequest, VercelResponse } from '@vercel/node';
import { makeViewCounter } from '../lib/view-counter.js';
import { DOWNLOAD_FILENAME } from '../constants/constants.js';
import { originFrom } from '../lib/origin-from.js';
import { loadPdf } from '../lib/load-pdf.js';
import { isCrawler, buildPreviewHtml } from '../lib/og-preview.js';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Link-unfurl crawlers get the OpenGraph HTML preview, not the PDF bytes.
  if (isCrawler(req.headers['user-agent'] as string)) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.end(buildPreviewHtml(originFrom(req)));
    return;
  }

  const pdf = loadPdf();
  if (!pdf) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Resume PDF has not been built yet. Run the CI pipeline to generate it.');
    return;
  }

  // Count the view, but never let a counter failure block serving the PDF.
  await makeViewCounter().increment('resume:views');

  const download = !!(req.query && 'download' in req.query);
  const encoded = encodeURIComponent(DOWNLOAD_FILENAME);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${DOWNLOAD_FILENAME}"; filename*=UTF-8''${encoded}`,
  );
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.statusCode = 200;
  res.end(pdf);
}
