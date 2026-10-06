import { defineConfig } from 'vitest/config';

// 10-testing-and-quality §3: unit tests next to code, integration tests in test/integration.
// Integration tests share one in-memory MongoDB replica set (test/setup/globalSetup.ts); the
// BullMQ adapter test needs a real Redis (REDIS_TEST_URL, default redis://127.0.0.1:6379/15,
// e.g. `docker compose up -d redis`).
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
        test: {
          name: 'integration',
          include: ['test/integration/**/*.int.test.ts'],
          globalSetup: ['test/setup/globalSetup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
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
        'src/docs/export.ts',
        'src/db/seed/**',
        'src/db/migrations/**',
      ],
      reporter: ['text', 'text-summary', 'lcov', 'cobertura'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
