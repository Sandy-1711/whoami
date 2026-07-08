import { defineConfig } from 'vitest/config';

// Unit tests live next to the pure logic they cover (scripts/**/*.test.ts) and
// never touch the network or the filesystem, so the default node environment is
// all they need.
export default defineConfig({
  test: {
    include: ['api/*.test.ts', 'scripts/**/*.test.ts', 'utils/**/*.test.ts', 'lib/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
    }
  },
});
