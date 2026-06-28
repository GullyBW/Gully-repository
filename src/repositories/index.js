'use strict';

const MongoTransactionRepository = require('./mongo.transaction.repository');
const MongoUserRepository = require('./mongo.user.repository');
const MongoBookingRepository = require('./mongo.booking.repository');
const MongoProviderRepository = require('./mongo.provider.repository');
const MongoReviewRepository = require('./mongo.review.repository');
const MongoFavouriteRepository = require('./mongo.favourite.repository');
const MongoNotificationRepository = require('./mongo.notification.repository');
const MongoAvailabilityRepository = require('./mongo.availability.repository');

/**
 * Central registry of repositories. Each defaults to its MongoDB implementation
 * in production; tests (or a local no-DB run) swap in the in-memory versions via
 * the setters. Every service layer reaches storage only through these getters,
 * so the whole backend is storage-agnostic.
 */
const repos = {
  transaction: new MongoTransactionRepository(),
  user: new MongoUserRepository(),
  booking: new MongoBookingRepository(),
  provider: new MongoProviderRepository(),
  review: new MongoReviewRepository(),
  favourite: new MongoFavouriteRepository(),
  notification: new MongoNotificationRepository(),
  availability: new MongoAvailabilityRepository(),
};

module.exports = {
  getTransactionRepository: () => repos.transaction,
  setTransactionRepository: (r) => {
    repos.transaction = r;
  },

  getUserRepository: () => repos.user,
  setUserRepository: (r) => {
    repos.user = r;
  },

  getBookingRepository: () => repos.booking,
  setBookingRepository: (r) => {
    repos.booking = r;
  },

  getProviderRepository: () => repos.provider,
  setProviderRepository: (r) => {
    repos.provider = r;
  },

  getReviewRepository: () => repos.review,
  setReviewRepository: (r) => {
    repos.review = r;
  },

  getFavouriteRepository: () => repos.favourite,
  setFavouriteRepository: (r) => {
    repos.favourite = r;
  },

  getNotificationRepository: () => repos.notification,
  setNotificationRepository: (r) => {
    repos.notification = r;
  },

  getAvailabilityRepository: () => repos.availability,
  setAvailabilityRepository: (r) => {
    repos.availability = r;
  },
};
