'use strict';

module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  // Jest owns tests/ only; Playwright owns e2e/ (run via `npm run test:e2e`).
  roots: ['<rootDir>/tests'],
  testTimeout: 30000,
};
