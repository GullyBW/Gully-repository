'use strict';

const MongoTransactionRepository = require('./mongo.transaction.repository');
const MongoUserRepository = require('./mongo.user.repository');
const MongoBookingRepository = require('./mongo.booking.repository');

/**
 * Holds the active repositories. Defaults to MongoDB in production; tests (or a
 * local no-DB run) swap in the in-memory implementations via the setters. This
 * keeps every service layer storage-agnostic.
 */
let transactionRepository = new MongoTransactionRepository();
let userRepository = new MongoUserRepository();
let bookingRepository = new MongoBookingRepository();

module.exports = {
  getTransactionRepository: () => transactionRepository,
  setTransactionRepository: (repo) => {
    transactionRepository = repo;
  },

  getUserRepository: () => userRepository,
  setUserRepository: (repo) => {
    userRepository = repo;
  },

  getBookingRepository: () => bookingRepository,
  setBookingRepository: (repo) => {
    bookingRepository = repo;
  },
};
