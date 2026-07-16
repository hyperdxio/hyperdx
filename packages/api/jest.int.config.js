const base = require('./jest.config.js');

/** @type {import("jest").Config} **/
module.exports = {
  ...base,
  testMatch: ['**/__tests__/**/*.int.test.ts?(x)'],
  // Override the unit config's ignore list: it excludes `.int.test.ts`, which
  // would otherwise hide every integration test from this suite.
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
};
