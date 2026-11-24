/**
 * Jest configuration for the REAL MongoDB Atlas integration suite.
 * Kept separate from the default (hermetic, fake-model) configuration so
 * `npm test` never needs a database and `npm run test:atlas:integration`
 * reports skipped tests with a reason when Atlas is unreachable.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/atlas'],
  testMatch: ['**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/atlas/setup.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Atlas round-trips plus index creation need more than the default 5s.
  testTimeout: 60000,
  verbose: true,
};
