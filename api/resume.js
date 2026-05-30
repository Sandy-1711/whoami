import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Redis } from '@upstash/redis';

// Connect to Vercel KV / Upstash Redis. Redis.fromEnv() reads
// UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN. If your integration
// injects KV_REST_API_URL / KV_REST_API_TOKEN instead, either add an alias in
// the Vercel project env, or swap to: new Redis({ url: process.env.KV_REST_API_URL,
// token: process.env.KV_REST_API_TOKEN }). See README.
let redis = null;
try {
  redis = Redis.fromEnv();
} catch {
  // No store configured yet — the resume still serves; views just won't count.
}

// Load the compiled PDF once per cold start. CI compiles resume.tex and places
// the result at assets/resume.pdf; vercel.json's includeFiles bundles it here.
function loadPdf() {
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

export default async function handler(req, res) {
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
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="resume.pdf"`,
  );
  // Bypass the CDN cache so every open re-invokes this function and is counted.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.statusCode = 200;
  res.end(pdf);
}
