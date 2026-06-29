'use strict';

// PostgreSQL integration tests — run against a real database.
//   DATABASE_URL=postgres://... npx jest --config jest.pg.config.js
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests-pg/setup.js'],
  roots: ['<rootDir>/tests-pg'],
  testTimeout: 30000,
};
