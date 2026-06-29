'use strict';

// Drives the real backend against PostgreSQL. The default driver is already
// `postgres`, so the registry built Postgres repositories; here we just ensure
// the schema and clean tables between tests.
const postgres = require('../src/db/postgres');

const TABLES = [
  'users', 'providers', 'bookings', 'transactions', 'reviews', 'favourites',
  'notifications', 'availabilities', 'refresh_tokens', 'audit_logs',
  'device_tokens', 'notification_preferences', 'saved_addresses',
  'conversations', 'messages',
];

beforeAll(async () => {
  await postgres.ensureSchema();
});

afterEach(async () => {
  await postgres.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await postgres.close();
});
