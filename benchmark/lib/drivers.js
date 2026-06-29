'use strict';

/**
 * Builds a full set of repositories for each storage driver so the same
 * benchmark can be run against PostgreSQL, the in-memory store, and (optionally)
 * MongoDB. This NEVER touches the production repository registry or the
 * repository classes themselves — it only instantiates them, so the repository
 * abstraction is exercised exactly as the services use it.
 */
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const R = (p) => require(path.join(ROOT, 'src', 'repositories', p));

function buildMemoryRepositories() {
  return {
    user: new (R('memory.user.repository'))(),
    provider: new (R('memory.provider.repository'))(),
    booking: new (R('memory.booking.repository'))(),
    transaction: new (R('memory.transaction.repository'))(),
    review: new (R('memory.review.repository'))(),
    favourite: new (R('memory.favourite.repository'))(),
    notification: new (R('memory.notification.repository'))(),
    availability: new (R('memory.availability.repository'))(),
    refreshToken: new (R('memory.refreshToken.repository'))(),
    auditLog: new (R('memory.auditLog.repository'))(),
    deviceToken: new (R('memory.deviceToken.repository'))(),
    notificationPreference: new (R('memory.notificationPreference.repository'))(),
    savedAddress: new (R('memory.savedAddress.repository'))(),
    conversation: new (R('memory.conversation.repository'))(),
    message: new (R('memory.message.repository'))(),
  };
}

/** PostgreSQL repositories (the production default). */
function postgresDriver() {
  const { buildPostgresRepositories } = R('postgres');
  const postgres = require(path.join(ROOT, 'src', 'db', 'postgres'));
  return {
    name: 'postgres',
    repos: buildPostgresRepositories(),
    async setup() {
      await postgres.ensureSchema();
    },
    async truncate() {
      await postgres.query(
        `TRUNCATE users, providers, bookings, transactions, reviews, favourites,
         notifications, availabilities, refresh_tokens, audit_logs, device_tokens,
         notification_preferences, saved_addresses, conversations, messages
         RESTART IDENTITY CASCADE`
      );
    },
    async teardown() {
      await postgres.close();
    },
  };
}

/** In-memory repositories (the testing baseline). */
function memoryDriver() {
  let repos = buildMemoryRepositories();
  return {
    name: 'memory',
    get repos() {
      return repos;
    },
    async setup() {},
    async truncate() {
      repos = buildMemoryRepositories();
      this.repos = repos; // refresh reference
    },
    async teardown() {},
  };
}

/**
 * Optional MongoDB driver. Only usable when a reachable MONGODB_URI is given;
 * the orchestrator skips it otherwise so the suite still runs without Mongo.
 */
function mongoDriver(mongoUrl) {
  const mongoose = require('mongoose');
  function build() {
    return {
      user: new (R('mongo.user.repository'))(),
      provider: new (R('mongo.provider.repository'))(),
      booking: new (R('mongo.booking.repository'))(),
      transaction: new (R('mongo.transaction.repository'))(),
      review: new (R('mongo.review.repository'))(),
      favourite: new (R('mongo.favourite.repository'))(),
      notification: new (R('mongo.notification.repository'))(),
      availability: new (R('mongo.availability.repository'))(),
      refreshToken: new (R('mongo.refreshToken.repository'))(),
      auditLog: new (R('mongo.auditLog.repository'))(),
      deviceToken: new (R('mongo.deviceToken.repository'))(),
      notificationPreference: new (R('mongo.notificationPreference.repository'))(),
      savedAddress: new (R('mongo.savedAddress.repository'))(),
      conversation: new (R('mongo.conversation.repository'))(),
      message: new (R('mongo.message.repository'))(),
    };
  }
  return {
    name: 'mongo',
    repos: build(),
    async setup() {
      await mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 3000 });
    },
    async truncate() {
      await Promise.all(
        Object.values(mongoose.connection.collections).map((c) => c.deleteMany({}))
      );
    },
    async teardown() {
      await mongoose.connection.close();
    },
  };
}

module.exports = { buildMemoryRepositories, postgresDriver, memoryDriver, mongoDriver };
