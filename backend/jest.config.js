/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // The live Atlas suite has its own config (`npm run test:atlas:integration`);
  // the default run stays hermetic and needs no database.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/atlas/'],
  setupFiles: ['<rootDir>/tests/setup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};
