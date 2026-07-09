// The Open Graph preview image, served the same way as the PDF: loaded once per

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// cold start from the file bundled by vercel.json's includeFiles.
export function loadImage(): Buffer | null {
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