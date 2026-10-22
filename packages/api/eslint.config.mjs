import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import nodePlugin from 'eslint-plugin-n';
import securityPlugin from 'eslint-plugin-security';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'dist/**',
      'coverage/**',
      'src/coverage/**',
      'migrations/**',
      'migrate-mongo-config.ts',
      '**/*.config.js',
      '**/*.config.mjs',
      'jest.config.js',
      'jest.setup.ts',
    ],
  },
  {
    files: ['src/**/*.ts', '!migrations/**'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'simple-import-sort': simpleImportSort,
      prettier: prettierPlugin,
      n: nodePlugin,
      security: securityPlugin,
    },
    rules: {
      ...nodePlugin.configs.recommended.rules,
      ...securityPlugin.configs['recommended-legacy'].rules,
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-empty-object-type': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'warn',
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'n/no-missing-require': [
        'error',
        {
          tryExtensions: ['.js', '.ts', '.json'],
        },
      ],
      'n/no-process-exit': 'error',
      'n/no-missing-import': 'off',
      'n/no-unpublished-import': [
        'error',
        {
          allowModules: ['mongodb', 'supertest'],
        },
      ],
      'n/no-unsupported-features/es-syntax': [
        'error',
        {
          ignores: ['modules'],
        },
      ],
      'prettier/prettier': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\.(/|$)',
              message:
                'Use the @/ path alias instead of parent-relative imports (../).',
            },
          ],
        },
      ],
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        global: 'readonly',
      },
    },
  },
  {
    // Process entry points and the CLI task runner: exiting with a status code
    // on startup failure, task completion, or a last-resort uncaught-exception
    // handler is the intended behavior here.
    files: ['src/index.ts', 'src/tasks/index.ts'],
    rules: {
      'n/no-process-exit': 'off',
    },
  },
];
