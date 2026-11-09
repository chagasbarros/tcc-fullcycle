import { defineConfig } from 'vitest/config';

/**
 * Contract tests (npm run test:contract), Pact consumer-driven:
 *   1. consumer test writes tests/contract/pacts/*.json (what the storefront expects);
 *   2. provider test replays that pact against the real HTTP app.
 * The npm script runs them in this order.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/contract/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
