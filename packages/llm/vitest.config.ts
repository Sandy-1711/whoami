import { defineConfig } from 'vitest/config';

// Unit tests live next to the code they cover (src/**/*.test.ts) and never touch
// the network — model calls go through the fake in src/testing.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
