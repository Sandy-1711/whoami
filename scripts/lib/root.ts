// The repo root, resolved once. scripts/lib/ -> ../../ is the project root.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const root: string = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
