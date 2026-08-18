const { createJsWithTsPreset } = require('ts-jest');

const base = require('./jest.config.js');

// http-proxy-middleware v4 (and its proxy core, httpxy) ship ESM-only builds
// that Jest's CJS loader cannot parse. The unit config blanket-mocks the
// package (see jest.setup.ts), but the clickhouse-proxy integration tests
// exercise the real proxy, so the int config transpiles those two packages to
// CJS via ts-jest instead. `allowJs` lets ts-jest compile their plain-JS ESM
// sources; the extra `.mjs` transform covers httpxy's `dist/index.mjs` entry.
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
