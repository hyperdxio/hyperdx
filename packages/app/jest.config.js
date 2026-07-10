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
};
