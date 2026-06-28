'use strict';

/**
 * Standalone API server backed entirely by in-memory repositories — no MongoDB,
 * Redis, FCM, Google Maps or cloud storage required. Used by the Playwright E2E
 * suite (and handy for local smoke testing). NOT for production.
 *
 *   PORT=4010 node src/test-server.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const os = require('os');
const path = require('path');
const config = require('./config');

// Throwaway uploads dir.
config.storage.localDir = path.join(os.tmpdir(), 'tirelo-e2e-uploads');

const repositories = require('./repositories');
const MemoryTransactionRepository = require('./repositories/memory.transaction.repository');
const MemoryUserRepository = require('./repositories/memory.user.repository');
const MemoryBookingRepository = require('./repositories/memory.booking.repository');
const MemoryProviderRepository = require('./repositories/memory.provider.repository');
const MemoryReviewRepository = require('./repositories/memory.review.repository');
const MemoryFavouriteRepository = require('./repositories/memory.favourite.repository');
const MemoryNotificationRepository = require('./repositories/memory.notification.repository');
const MemoryAvailabilityRepository = require('./repositories/memory.availability.repository');
const MemoryRefreshTokenRepository = require('./repositories/memory.refreshToken.repository');
const MemoryAuditLogRepository = require('./repositories/memory.auditLog.repository');
const MemoryDeviceTokenRepository = require('./repositories/memory.deviceToken.repository');
const MemoryNotificationPreferenceRepository = require('./repositories/memory.notificationPreference.repository');
const MemorySavedAddressRepository = require('./repositories/memory.savedAddress.repository');
const MemoryConversationRepository = require('./repositories/memory.conversation.repository');
const MemoryMessageRepository = require('./repositories/memory.message.repository');

repositories.setTransactionRepository(new MemoryTransactionRepository());
repositories.setUserRepository(new MemoryUserRepository());
repositories.setBookingRepository(new MemoryBookingRepository());
repositories.setProviderRepository(new MemoryProviderRepository());
repositories.setReviewRepository(new MemoryReviewRepository());
repositories.setFavouriteRepository(new MemoryFavouriteRepository());
repositories.setNotificationRepository(new MemoryNotificationRepository());
repositories.setAvailabilityRepository(new MemoryAvailabilityRepository());
repositories.setRefreshTokenRepository(new MemoryRefreshTokenRepository());
repositories.setAuditLogRepository(new MemoryAuditLogRepository());
repositories.setDeviceTokenRepository(new MemoryDeviceTokenRepository());
repositories.setNotificationPreferenceRepository(new MemoryNotificationPreferenceRepository());
repositories.setSavedAddressRepository(new MemorySavedAddressRepository());
repositories.setConversationRepository(new MemoryConversationRepository());
repositories.setMessageRepository(new MemoryMessageRepository());

const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const createApp = require('./app');
const { attachSocket } = require('./realtime/socket');
const userDomain = require('./domain/user');

// Outer app exposes a TEST-ONLY admin seed route (never part of production app),
// then mounts the real API. Lets the E2E suite exercise admin journeys.
const outer = express();
outer.use(express.json());
outer.post('/__test__/seed-admin', async (_req, res) => {
  const user = userDomain.createUser({
    name: 'E2E Admin',
    email: `admin-${Date.now()}@example.com`,
    passwordHash: 'x',
    role: 'admin',
  });
  await repositories.getUserRepository().create(user);
  const token = jwt.sign(
    { sub: user.id, role: 'admin', email: user.email },
    config.auth.jwtSecret,
    { expiresIn: '1h' }
  );
  res.json({ token, user: userDomain.toPublicJSON(user) });
});
outer.use(createApp());

const port = parseInt(process.env.PORT, 10) || 4010;
const server = http.createServer(outer);
attachSocket(server, { cors: { origin: '*' } });
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[tirelo-e2e] in-memory API listening on ${port}`);
});
