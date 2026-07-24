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
  // Coverage floor pinned just below measured reality so coverage can only
  // ratchet up. Decay below these numbers fails the build. Raise them
  // deliberately as coverage improves; never lower them silently.
  coverageThreshold: {
    global: {
      statements: 70,
      branches: 55,
      functions: 72,
      lines: 71,
    },
  },
};
