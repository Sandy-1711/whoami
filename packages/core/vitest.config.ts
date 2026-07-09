import { defineConfig } from 'vitest/config';

// Unit tests live next to the code they cover (src/**/*.test.ts) and never touch
// the network or a real filesystem beyond os.tmpdir(), so the node environment
// is all they need.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
