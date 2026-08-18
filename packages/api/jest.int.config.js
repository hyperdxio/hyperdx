const { createJsWithTsPreset } = require('ts-jest');

const base = require('./jest.config.js');

// http-proxy-middleware v4 and its deps ship ESM-only builds Jest's CJS
// loader can't parse. jest.setup.ts blanket-mocks the package; the
// clickhouse-proxy int tests need the real thing, so transpile it here
// (`allowJs` for the plain-JS sources, `.mjs` for httpxy's entry).
const esmDepsTransformCfg = createJsWithTsPreset({
  tsconfig: {
    rootDir: './src',
    allowJs: true,
  },
});

/** @type {import("jest").Config} **/
module.exports = {
  ...base,
  transform: {
    ...esmDepsTransformCfg.transform,
    '^.+\\.mjs$': esmDepsTransformCfg.transform['^.+\\.[tj]sx?$'],
  },
  moduleFileExtensions: ['js', 'mjs', 'json', 'ts', 'tsx', 'node'],
  transformIgnorePatterns: [
    '/node_modules/(?!(http-proxy-middleware|httpxy|is-plain-obj)/)',
  ],
  testMatch: ['**/__tests__/**/*.int.test.ts?(x)'],
  // Override the unit config's ignore list: it excludes `.int.test.ts`, which
  // would otherwise hide every integration test from this suite.
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
};
