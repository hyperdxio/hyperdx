const { createJsWithTsPreset } = require('ts-jest');

const tsJestTransformCfg = createJsWithTsPreset({
  tsconfig: {
    jsx: 'react-jsx',
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
  transformIgnorePatterns: ['/node_modules/(?!(nuqs)/)'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^ky-universal$': '<rootDir>/src/__mocks__/ky-universal.ts',
    '^ky$': '<rootDir>/src/__mocks__/ky-universal.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.tsx'],
};
