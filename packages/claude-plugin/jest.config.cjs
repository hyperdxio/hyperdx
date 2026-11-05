/** @type {import("jest").Config} **/
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  rootDir: './src',
  // *.test.ts(x) belong to `claude plugin test`, which runs every such file in the folder.
  testMatch: ['**/__tests__/*.spec.ts'],
  moduleNameMapper: {
    // The CLI source this package renders with resolves its own `@/` alias.
    '^@/(.*)$': '<rootDir>/../../cli/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
};
