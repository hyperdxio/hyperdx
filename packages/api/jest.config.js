const { createJsWithTsPreset } = require('ts-jest');

const tsJestTransformCfg = createJsWithTsPreset({
  tsconfig: {
    // TypeScript 6 requires an explicit rootDir when compiling a subset of
    // files (ts-jest compiles per-file), otherwise it errors with TS5011.
    rootDir: './src',
  },
});

/** @type {import("jest").Config} **/
module.exports = {
  ...tsJestTransformCfg,
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
  setupFiles: ['dotenv-expand/config'],
  testEnvironment: 'node',
  verbose: true,
  rootDir: './src',
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '.*\\.int\\.test\\.tsx?$'],
  testTimeout: 30000,
  moduleNameMapper: {
    '@/(.*)$': '<rootDir>/$1',
  },
};
