import { loadImage } from "../lib/load-image"
import type { VercelRequest, VercelResponse } from '@vercel/node';



export default function handler(_req: VercelRequest, res: VercelResponse): void {
  const image = loadImage();
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
