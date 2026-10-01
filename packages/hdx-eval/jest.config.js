const { createJsWithTsPreset } = require('ts-jest');

const tsJestTransformCfg = createJsWithTsPreset({
  tsconfig: {
    // The AI SDK (v7+) ships ESM-only builds that Jest's CJS loader can't
    // parse, so they are transpiled like source (see transformIgnorePatterns).
    allowJs: true,
  },
});

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
  transformIgnorePatterns: ['/node_modules/(?!(ai|@ai-sdk|@workflow/serde)/)'],
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
