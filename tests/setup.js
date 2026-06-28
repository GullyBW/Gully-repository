'use strict';

const os = require('os');
const path = require('path');
const config = require('../src/config');

// Point uploads at a throwaway temp dir during tests.
config.storage.localDir = path.join(os.tmpdir(), 'tirelo-uploads-test');

const repositories = require('../src/repositories');

const MemoryTransactionRepository = require('../src/repositories/memory.transaction.repository');
const MemoryUserRepository = require('../src/repositories/memory.user.repository');
const MemoryBookingRepository = require('../src/repositories/memory.booking.repository');
const MemoryProviderRepository = require('../src/repositories/memory.provider.repository');
const MemoryReviewRepository = require('../src/repositories/memory.review.repository');
const MemoryFavouriteRepository = require('../src/repositories/memory.favourite.repository');
const MemoryNotificationRepository = require('../src/repositories/memory.notification.repository');
const MemoryAvailabilityRepository = require('../src/repositories/memory.availability.repository');
const MemoryRefreshTokenRepository = require('../src/repositories/memory.refreshToken.repository');
const MemoryAuditLogRepository = require('../src/repositories/memory.auditLog.repository');
const MemoryDeviceTokenRepository = require('../src/repositories/memory.deviceToken.repository');
const MemoryNotificationPreferenceRepository = require('../src/repositories/memory.notificationPreference.repository');
const MemorySavedAddressRepository = require('../src/repositories/memory.savedAddress.repository');
const MemoryConversationRepository = require('../src/repositories/memory.conversation.repository');
const MemoryMessageRepository = require('../src/repositories/memory.message.repository');

// Run the whole suite against in-memory stores so no MongoDB is required.
const stores = {
  transaction: new MemoryTransactionRepository(),
  user: new MemoryUserRepository(),
  booking: new MemoryBookingRepository(),
  provider: new MemoryProviderRepository(),
  review: new MemoryReviewRepository(),
  favourite: new MemoryFavouriteRepository(),
  notification: new MemoryNotificationRepository(),
  availability: new MemoryAvailabilityRepository(),
  refreshToken: new MemoryRefreshTokenRepository(),
  auditLog: new MemoryAuditLogRepository(),
  deviceToken: new MemoryDeviceTokenRepository(),
  notificationPreference: new MemoryNotificationPreferenceRepository(),
  savedAddress: new MemorySavedAddressRepository(),
  conversation: new MemoryConversationRepository(),
  message: new MemoryMessageRepository(),
};

repositories.setTransactionRepository(stores.transaction);
repositories.setUserRepository(stores.user);
repositories.setBookingRepository(stores.booking);
repositories.setProviderRepository(stores.provider);
repositories.setReviewRepository(stores.review);
repositories.setFavouriteRepository(stores.favourite);
repositories.setNotificationRepository(stores.notification);
repositories.setAvailabilityRepository(stores.availability);
repositories.setRefreshTokenRepository(stores.refreshToken);
repositories.setAuditLogRepository(stores.auditLog);
repositories.setDeviceTokenRepository(stores.deviceToken);
repositories.setNotificationPreferenceRepository(stores.notificationPreference);
repositories.setSavedAddressRepository(stores.savedAddress);
repositories.setConversationRepository(stores.conversation);
repositories.setMessageRepository(stores.message);

afterEach(async () => {
  await Promise.all(Object.values(stores).map((s) => (s.clear ? s.clear() : null)));
});
