import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// The Open Graph preview image, served the same way as the PDF: loaded once per
// cold start from the file bundled by vercel.json's includeFiles.
function loadImage() {
  const candidates = [
    fileURLToPath(new URL('../assets/og.jpg', import.meta.url)),
    join(process.cwd(), 'assets', 'og.jpg'),
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
const image = loadImage();

export default function handler(req, res) {
  if (!image) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('OG image not found.');
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  // Safe to cache hard — the image only changes on deploy.
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
  res.statusCode = 200;
  res.end(image);
}
