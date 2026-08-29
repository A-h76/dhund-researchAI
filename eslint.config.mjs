import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'test/fixtures/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name=/^(extractUuidTimestamp|uuidTimestamp|getUuidTime|timestampFromUuid|createdAtFromUuid)$/]",
          message:
            'GAP-PK-01: do not extract timestamps from UUIDv7; use created_at TIMESTAMPTZ.',
        },
        {
          selector:
            "MemberExpression[object.name='uuid'][property.name=/^(getTimestamp|timestamp)$/]",
          message:
            'GAP-PK-01: do not extract timestamps from UUIDv7; use created_at TIMESTAMPTZ.',
        },
      ],
    },
  },
  {
    files: ['src/projects/**/*.ts', 'test/fixtures/eslint/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ingestion/*', '@retrieval/*', '@evidence/*', '@orchestration/*', '@ai/*'],
              message: 'L3 (projects) must not import from L4+ layers.',
            },
            {
              group: ['**/ingestion/**', '**/retrieval/**', '**/evidence/**', '**/orchestration/**', '**/ai/**'],
              message: 'L3 (projects) must not import from L4+ layers.',
            },
          ],
        },
      ],
    },
  },
);
