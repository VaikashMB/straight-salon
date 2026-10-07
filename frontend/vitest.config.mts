import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 10-testing-and-quality §4. Unit/component tests live in tests/unit; e2e (Playwright) in tests/e2e.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    // The page origin the API client calls (MSW mocks it; tests/unit/helpers/api.ts).
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/lib/api/schema.d.ts',
        'src/components/ui/**',
        'src/app/**/layout.tsx',
        'src/app/fonts.ts', // next/font declarations only (used by the root layout)
      ],
      reporter: ['text', 'text-summary', 'lcov', 'cobertura'],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
