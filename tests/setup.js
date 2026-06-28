'use strict';

const {
  setTransactionRepository,
  setUserRepository,
  setBookingRepository,
} = require('../src/repositories');
const MemoryTransactionRepository = require('../src/repositories/memory.transaction.repository');
const MemoryUserRepository = require('../src/repositories/memory.user.repository');
const MemoryBookingRepository = require('../src/repositories/memory.booking.repository');

// Run the whole suite against in-memory stores so no MongoDB is required.
const txnRepo = new MemoryTransactionRepository();
const userRepo = new MemoryUserRepository();
const bookingRepo = new MemoryBookingRepository();

setTransactionRepository(txnRepo);
setUserRepository(userRepo);
setBookingRepository(bookingRepo);

afterEach(async () => {
  await Promise.all([txnRepo.clear(), userRepo.clear(), bookingRepo.clear()]);
});
