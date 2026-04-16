const { createJsWithTsPreset } = require('ts-jest');

const tsJestTransformCfg = createJsWithTsPreset();

/** @type {import("jest").Config} **/
module.exports = {
  ...tsJestTransformCfg,
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
  setupFiles: ['dotenv-expand/config'],
  testEnvironment: 'node',
  verbose: true,
  rootDir: './src',
  testMatch: ['**/__tests__/*.test.ts?(x)'],
  testTimeout: 30000,
  moduleNameMapper: {
    '@/(.*)$': '<rootDir>/$1',
  },
};
