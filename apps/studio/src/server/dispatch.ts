// Which half of the server handles a request. One port serves both, so this is
// the seam between them.

/**
 * Whether a request belongs to Hono rather than to Vite.
 *
 * The boundary is the slash, and it matters: the SPA has a module at
 * `src/web/api.ts`, which Vite asks for as `/api.ts`. A prefix test on `/api`
 * swallows it, the import 404s, and the whole page renders blank.
 */
export function isApiRequest(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0] ?? '';
  return path === '/api' || path.startsWith('/api/');
}
