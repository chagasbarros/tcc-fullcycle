import { defineConfig } from 'vitest/config';

/**
 * Integration tests (npm run test:integration): real PostgreSQL and Redis in
 * throwaway containers (Testcontainers). Needs Docker running.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    // Files share one database and truncate it between tests: run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
