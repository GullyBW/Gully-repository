'use strict';

const repositories = require('../src/repositories');

const MemoryTransactionRepository = require('../src/repositories/memory.transaction.repository');
const MemoryUserRepository = require('../src/repositories/memory.user.repository');
const MemoryBookingRepository = require('../src/repositories/memory.booking.repository');
const MemoryProviderRepository = require('../src/repositories/memory.provider.repository');
const MemoryReviewRepository = require('../src/repositories/memory.review.repository');
const MemoryFavouriteRepository = require('../src/repositories/memory.favourite.repository');
const MemoryNotificationRepository = require('../src/repositories/memory.notification.repository');
const MemoryAvailabilityRepository = require('../src/repositories/memory.availability.repository');

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
};

repositories.setTransactionRepository(stores.transaction);
repositories.setUserRepository(stores.user);
repositories.setBookingRepository(stores.booking);
repositories.setProviderRepository(stores.provider);
repositories.setReviewRepository(stores.review);
repositories.setFavouriteRepository(stores.favourite);
repositories.setNotificationRepository(stores.notification);
repositories.setAvailabilityRepository(stores.availability);

afterEach(async () => {
  await Promise.all(Object.values(stores).map((s) => s.clear()));
});
