import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';

// 10-testing-and-quality §6: Next rules, type-checked TS rules, jsx-a11y recommended,
// no import cycles, no console, no floating promises, no explicit any.
export default defineConfig([
  globalIgnores(['.next/', 'out/', 'coverage/', 'next-env.d.ts']),
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'import/no-cycle': 'error',
    },
  },
]);
