import type { VercelRequest } from '@vercel/node';
export function originFrom(req: VercelRequest): string {
    const host =
        req.headers['x-forwarded-host'] ||
        req.headers.host ||
        'iamsandeep.vercel.app';

    const proto = req.headers['x-forwarded-proto'] || 'https';

    return `${proto}://${host}`;
}