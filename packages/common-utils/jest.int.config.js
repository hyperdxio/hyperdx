const { createJsWithTsPreset } = require('ts-jest');

const tsJestTransformCfg = createJsWithTsPreset();

/** @type {import("jest").Config} **/
module.exports = {
  ...tsJestTransformCfg,
  setupFiles: ['dotenv-expand/config'],
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
  verbose: true,
  rootDir: './src',
  testMatch: ['**/__tests__/*.int.test.ts?(x)'],
  testTimeout: 30000,
  moduleNameMapper: {
    '@/(.*)$': '<rootDir>/$1',
  },
};
