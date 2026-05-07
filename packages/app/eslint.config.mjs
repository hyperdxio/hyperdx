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

const LOCAL_I18N_PLUGIN = {
  rules: {
    'no-jsx-text-outside-trans': {
      meta: {
        type: 'problem',
        fixable: 'code',
        docs: {
          description:
            'Disallow user-facing JSX text outside of Trans components in migrated files.',
        },
        schema: [
          {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        ],
        messages: {
          wrapInTrans:
            'Wrap user-facing JSX text in <Trans> so it can be translated.',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode;
        let hasTransImport = false;
        let hasUntranslatedText = false;

        const hasWords = value => /[\p{L}\p{N}]/u.test(value);

        const isInsideTrans = node => {
          let current = node.parent;

          while (current) {
            if (
              current.type === 'JSXElement' &&
              current.openingElement.name.type === 'JSXIdentifier' &&
              current.openingElement.name.name === 'Trans'
            ) {
              return true;
            }

            current = current.parent;
          }

          return false;
        };

        const getTransImportFix = fixer => {
          if (hasTransImport) {
            return null;
          }

          const body = sourceCode.ast.body;
          const lastImport = body.findLast(
            node => node.type === 'ImportDeclaration',
          );

          if (lastImport) {
            return fixer.insertTextAfter(
              lastImport,
              "\nimport { Trans } from 'next-i18next/pages';",
            );
          }

          return fixer.insertTextBefore(
            body[0] ?? sourceCode.ast,
            "import { Trans } from 'next-i18next/pages';\n\n",
          );
        };

        return {
          ImportDeclaration(node) {
            if (
              node.source.value === 'next-i18next/pages' ||
              node.source.value === 'react-i18next'
            ) {
              hasTransImport ||= node.specifiers.some(
                specifier =>
                  specifier.type === 'ImportSpecifier' &&
                  specifier.imported.type === 'Identifier' &&
                  specifier.imported.name === 'Trans',
              );
            }
          },
          'Program:exit'(node) {
            if (!hasUntranslatedText || hasTransImport) {
              return;
            }

            context.report({
              node,
              message:
                'Import Trans so JSX text can be wrapped for translation.',
              fix: getTransImportFix,
            });
          },
          JSXText(node) {
            if (!hasWords(node.value) || isInsideTrans(node)) {
              return;
            }

            hasUntranslatedText = true;

            context.report({
              node,
              loc: sourceCode.getLocFromIndex(
                node.range[0] + node.value.search(/[\p{L}\p{N}]/u),
              ),
              messageId: 'wrapInTrans',
              fix(fixer) {
                const leadingWhitespace = node.value.match(/^\s*/u)?.[0] ?? '';
                const trailingWhitespace = node.value.match(/\s*$/u)?.[0] ?? '';
                const text = node.value.trim();

                return fixer.replaceText(
                  node,
                  `${leadingWhitespace}<Trans>${text}</Trans>${trailingWhitespace}`,
                );
              },
            });
          },
        };
      },
    },
  },
};

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
      'local-i18n': LOCAL_I18N_PLUGIN,
      'react-hooks': reactHooksPlugin,
      'simple-import-sort': simpleImportSort,
      'react-hook-form': fixupPluginRules(reactHookFormPlugin), // not compatible with eslint 9 yet
      ...eslintReactPlugin.configs.recommended.plugins,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...eslintReactPlugin.configs['recommended-type-checked'].rules,

      // Non-default react-hooks rules
      'react-hooks/set-state-in-render': 'error',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/exhaustive-deps': 'error',

      // Disable rules from @eslint-react that have equivalent rules enabled in eslint-plugin-react-hooks
      '@eslint-react/rules-of-hooks': 'off',
      '@eslint-react/component-hook-factories': 'off',
      '@eslint-react/exhaustive-deps': 'off',
      '@eslint-react/error-boundaries': 'off',
      '@eslint-react/immutability': 'off',
      '@eslint-react/purity': 'off',
      '@eslint-react/refs': 'off',
      '@eslint-react/set-state-in-effect': 'off',
      '@eslint-react/set-state-in-render': 'off',
      '@eslint-react/no-nested-component-definitions': 'off',
      '@eslint-react/no-nested-lazy-component-declarations': 'off',
      '@eslint-react/unsupported-syntax': 'off',
      '@eslint-react/use-memo': 'off',

      'react-hook-form/no-use-watch': 'error',
      'local-i18n/no-jsx-text-outside-trans': 'error',
      '@eslint-react/no-unstable-default-props': 'error',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-unsafe-type-assertion': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
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
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
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
