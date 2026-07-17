const { createJsWithTsPreset } = require('ts-jest');

const tsJestTransformCfg = createJsWithTsPreset({
  tsconfig: {
    jsx: 'react-jsx',
    // TypeScript 6 requires an explicit rootDir when compiling a subset of
    // files (ts-jest compiles per-file), otherwise it errors with TS5011.
    rootDir: './src',
  },
});

/** @type {import("jest").Config} **/
module.exports = {
  ...tsJestTransformCfg,
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  globalSetup: '<rootDir>/global-setup.js',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
  transformIgnorePatterns: ['/node_modules/'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^ky-universal$': '<rootDir>/src/__mocks__/ky-universal.ts',
    '^ky$': '<rootDir>/src/__mocks__/ky-universal.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.tsx'],
  // Coverage floors are scoped to hooks/ and utils/ only — the genuinely
  // unit-testable code. React components carry no coverage requirement (unit
  // tests on them tend to be low-value and fragile; E2E and Storybook cover
  // them better). Each floor is pinned just below measured reality so coverage
  // can only ratchet up; decay below these numbers fails the build. Raise them
  // deliberately as coverage improves; never lower them silently.
  coverageThreshold: {
    './src/hooks/': {
      statements: 72,
      branches: 59,
      functions: 66,
      lines: 73,
    },
    './src/utils/': {
      statements: 74,
      branches: 59,
      functions: 72,
      lines: 76,
    },
    './src/utils.ts': {
      statements: 76,
      branches: 77,
      functions: 75,
      lines: 76,
    },
  },
};
