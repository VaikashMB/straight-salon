import { defineConfig } from 'vitest/config';

// 10-testing-and-quality §3: unit tests next to code, integration tests in test/integration.
export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/__tests__/**/*.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'integration', include: ['test/integration/**/*.int.test.ts'] },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/__tests__/**',
        'src/server.ts',
        'src/worker.ts',
        'src/relay.ts',
        'src/db/seed/**',
        'src/db/migrations/**',
      ],
      reporter: ['text', 'text-summary', 'lcov', 'cobertura'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
