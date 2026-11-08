import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Unit tests live next to the code (*.spec.ts).
    // Integration (tests/integration) and contract (tests/contract) get their own scripts.
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/server.ts'],
      reporter: ['text', 'html', 'lcov'],
      // Minimum declared in the pipeline (CLAUDE.md, section 7):
      // 80% of lines in the business core (domain/ and application/).
      thresholds: {
        'src/modules/*/domain/**': { lines: 80 },
        'src/modules/*/application/**': { lines: 80 },
      },
    },
  },
});
