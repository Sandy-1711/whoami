import { defineConfig } from 'vitest/config';

// Unit tests live next to the code they cover (src/**/*.test.ts). Tool tests use
// fake deps (no network, no real LLM/PDF/Gmail), so the node environment is all
// they need.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
