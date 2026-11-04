import baseConfig from './jest.config.js';

export default {
  ...baseConfig,
  testMatch: ['**/tests/flight/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  globalSetup: './tests/flight/jest.globalSetup.js',
  setupFilesAfterEnv: ['./tests/flight/jest.setup.js'],
  globalTeardown: './tests/flight/jest.teardown.js',
};
