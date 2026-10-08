import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import security from 'eslint-plugin-security';
import globals from 'globals';
import { configs as tsConfigs } from 'typescript-eslint';

// 10-testing-and-quality §6: type-checked rules, no import cycles, security plugin,
// no console, no floating promises, no explicit any.
export default defineConfig([
  globalIgnores(['dist/', 'coverage/', 'reports/']),
  js.configs.recommended,
  tsConfigs.recommendedTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  security.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: { allowDefaultProject: ['*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ project: './tsconfig.json' })],
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'import-x/no-cycle': 'error',
      // Flags every obj[key] read, including keys from Object.keys() of our own objects and
      // fixed unions: all hits were false positives. Injection is handled by strict Zod
      // schemas and Mongoose sanitizeFilter (06 §4). Other security rules stay on.
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    extends: [tsConfigs.disableTypeChecked],
  },
]);
