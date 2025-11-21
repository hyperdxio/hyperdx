module.exports = {
  preset: 'ts-jest/presets/js-with-ts',
  testEnvironment: 'jsdom',
  globalSetup: '<rootDir>/global-setup.js',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
  transformIgnorePatterns: ['/node_modules/(?!(ky|ky-universal|flat))'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^ky-universal$': '<rootDir>/src/__mocks__/ky-universal.ts',
    '^ky$': '<rootDir>/src/__mocks__/ky-universal.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.tsx'],
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
