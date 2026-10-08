export default {
  testEnvironment: 'node',
  testTimeout: 180000,
  transform: {},
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/flight/', '<rootDir>/tests/hotel/'],
  verbose: true,
};
