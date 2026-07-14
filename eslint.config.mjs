import tsParser from '@typescript-eslint/parser';

const sharedRules = {
  'no-process-env': 'error',
};

export default [
  {
    ignores: ['src/**', '**/*.test.ts', '**/*.test.tsx', '**/*.interaction.test.tsx'],
  },
  {
    files: ['packages/server/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: sharedRules,
  },
  {
    files: ['packages/shared/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: sharedRules,
  },
  {
    files: ['packages/shared/src/config/**/*.ts'],
    rules: {
      'no-process-env': 'off',
    },
  },
  {
    files: ['packages/db/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: sharedRules,
  },
  {
    files: ['eslint.config.mjs'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
    },
  },
];
