module.exports = {
  preset: 'ts-jest/presets/js-with-ts',
  testEnvironment: 'jsdom',
  globalSetup: '<rootDir>/global-setup.js',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
  transformIgnorePatterns: ['/node_modules/(?!(ky|ky-universal))'],
  moduleNameMapper: {
    '@/(.*)$': '<rootDir>/src/$1',
  },
  // Prettier 3 not supported yet
  // See: https://stackoverflow.com/a/76818962
  prettierPath: null,
  globals: {
    // This is necessary because next.js forces { "jsx": "preserve" }, but ts-jest appears to require { "jsx": "react-jsx" }
    'ts-jest': {
      tsconfig: {
        jsx: 'react-jsx',
      },
    },
  },
};
