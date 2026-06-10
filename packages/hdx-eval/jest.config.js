const { createJsWithTsPreset } = require('ts-jest');

const tsJestTransformCfg = createJsWithTsPreset();

/** @type {import("jest").Config} **/
module.exports = {
  ...tsJestTransformCfg,
  testEnvironment: 'node',
  rootDir: './src',
  testMatch: ['**/__tests__/*.test.ts'],
  testTimeout: 15000,
  moduleNameMapper: {
    '@/(.*)$': '<rootDir>/$1',
  },
};
