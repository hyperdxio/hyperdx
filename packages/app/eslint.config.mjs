import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import storybook from 'eslint-plugin-storybook';
import nextPlugin from '@next/eslint-plugin-next';
import eslintReactPlugin from '@eslint-react/eslint-plugin';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import prettierPlugin from 'eslint-plugin-prettier/recommended';
import playwrightPlugin from 'eslint-plugin-playwright';
import reactHookFormPlugin from 'eslint-plugin-react-hook-form';
import { fixupPluginRules } from '@eslint/compat';

// Kept separate so test overrides can drop just the date rules while keeping
// the UI style rules (bi-icons, Button/ActionIcon variants).
const UI_SYNTAX_RESTRICTIONS = [
  // Temporary rule to enforce use of @tabler/icons-react instead of bi bi-icons
  // Will remove after we've updated all icons and let some PRs merge.
  {
    selector: 'Literal[value=/\\bbi-\\b/i]',
    message: 'Please update to use @tabler/icons-react instead',
  },
  // Enforce custom Button/ActionIcon variants (see agent_docs/code_style.md)
  // NOTE: Icon-only Buttons should use ActionIcon instead - this requires manual review
  // as ESLint cannot detect children content patterns
  {
    selector:
      'JSXElement[openingElement.name.name="Button"] JSXAttribute[name.name="variant"][value.value="light"]',
    message:
      'Use variant="primary", "secondary", or "danger" for Button. See agent_docs/code_style.md',
  },
  {
    selector:
      'JSXElement[openingElement.name.name="Button"] JSXAttribute[name.name="variant"][value.value="filled"]',
    message:
      'Use variant="primary", "secondary", or "danger" for Button. See agent_docs/code_style.md',
  },
  {
    selector:
      'JSXElement[openingElement.name.name="Button"] JSXAttribute[name.name="variant"][value.value="outline"]',
    message:
      'Use variant="primary", "secondary", or "danger" for Button. See agent_docs/code_style.md',
  },
  {
    selector:
      'JSXElement[openingElement.name.name="Button"] JSXAttribute[name.name="variant"][value.value="default"]',
    message:
      'Use variant="primary", "secondary", or "danger" for Button. See agent_docs/code_style.md',
  },
  {
    selector:
      'JSXElement[openingElement.name.name="ActionIcon"] JSXAttribute[name.name="variant"][value.value="light"]',
    message:
      'Use variant="primary", "secondary", or "danger" for ActionIcon. See agent_docs/code_style.md',
  },
  {
    selector:
      'JSXElement[openingElement.name.name="ActionIcon"] JSXAttribute[name.name="variant"][value.value="filled"]',
    message:
      'Use variant="primary", "secondary", or "danger" for ActionIcon. See agent_docs/code_style.md',
  },
  {
    selector:
      'JSXElement[openingElement.name.name="ActionIcon"] JSXAttribute[name.name="variant"][value.value="outline"]',
    message:
      'Use variant="primary", "secondary", or "danger" for ActionIcon. See agent_docs/code_style.md',
  },
];

const DATE_SYNTAX_RESTRICTIONS = [
  {
    selector:
      'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
    message:
      'Date.now() can cause unnecessary re-renders. Import NOW from @/config for a stable reference, or wrap in useMemo/useCallback for values that must be current.',
  },
  {
    selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
    message:
      'new Date() can cause unnecessary re-renders. Use new Date(NOW) for a stable reference, or wrap in useMemo/useCallback for values that must be current.',
  },
];

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,
  prettierPlugin,
  {
    ignores: [
      'next-env.d.ts',
      'playwright-report/**',
      '.next/**',
      '.next-e2e/**',
      '.storybook/**',
      'node_modules/**',
      'out/**',
      'build/**',
      'coverage/**',
      'dist/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.cjs',
      '**/*.config.mjs',
      'eslint.config.mjs',
      'public/__ENV.js',
      'public/pyodide/**',
      'global-setup.js',
      'scripts/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooksPlugin,
      'simple-import-sort': simpleImportSort,
      'react-hook-form': fixupPluginRules(reactHookFormPlugin), // not compatible with eslint 9 yet
      ...eslintReactPlugin.configs.recommended.plugins,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...eslintReactPlugin.configs.recommended.rules,
      // Disable rules from eslint-plugin-react-hooks that have equivalent rules in @eslint-react
      ...eslintReactPlugin.configs['disable-conflict-eslint-plugin-react-hooks'].rules,
      ...eslintReactPlugin.configs['recommended-type-checked'].rules,
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/exhaustive-deps': 'error',
      'react-hook-form/no-use-watch': 'error',
      '@eslint-react/no-unstable-default-props': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^react$', '^next', '^[a-z]', '^@'],
            ['^@/'],
            ['^\\.\\.(?!/?$)', '^\\.\\./?$'],
            ['^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
            ['^.+\\.s?css$'],
            ['^\\u0000'],
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...UI_SYNTAX_RESTRICTIONS,
        ...DATE_SYNTAX_RESTRICTIONS,
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // TODO: Enable these rules and fix existing violations
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-unsafe-type-assertion': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        React: 'readonly',
        JSX: 'readonly',
        NodeJS: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    // Disable type-checked rules for JS files (not part of TypeScript project)
    files: ['**/*.{js,jsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-type-assertion': 'off',
    },
  },
  {
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'src/setupTests.tsx'],
    rules: {
      // Drop date rules — new Date() / Date.now() are fine in tests
      'no-restricted-syntax': ['error', ...UI_SYNTAX_RESTRICTIONS],
      '@eslint-react/component-hook-factories': 'off',
    },
  },
  {
    files: ['tests/e2e/**/*.{ts,js}'],
    ...playwrightPlugin.configs['flat/recommended'],
    rules: {
      ...playwrightPlugin.configs['flat/recommended'].rules,
      'no-console': 'off',
      'no-empty': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@next/next/no-html-link-for-pages': 'off',
      'playwright/no-networkidle': 'off', // temporary until we have a better way to deal with react re-renders
      // Drop date rules — Date.now() is fine in e2e tests for unique IDs/timestamps
      'no-restricted-syntax': ['error', ...UI_SYNTAX_RESTRICTIONS],
    },
  },
  ...storybook.configs['flat/recommended'],
];
