/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
  setupFiles: ['dotenv/config'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  verbose: true,
  rootDir: './src',
  testMatch: ['**/__tests__/*.test.ts?(x)'],
  testTimeout: 30000,
  moduleNameMapper: {
    '@/(.*)$': '<rootDir>/$1',
  },
};
