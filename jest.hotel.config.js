import baseConfig from './jest.config.js';

export default {
  ...baseConfig,
  testMatch: ['**/tests/hotel/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  globalSetup: './tests/hotel/jest.globalSetup.js',
  setupFilesAfterEnv: ['./tests/hotel/jest.setup.js'],
  globalTeardown: './tests/hotel/jest.teardown.js',
};
