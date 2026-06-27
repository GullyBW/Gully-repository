'use strict';

const MongoTransactionRepository = require('./mongo.transaction.repository');

/**
 * Holds the active transaction repository. Defaults to MongoDB in production;
 * tests (or a local no-DB run) can swap in the in-memory implementation via
 * `setTransactionRepository`. This keeps the service layer storage-agnostic.
 */
let transactionRepository = new MongoTransactionRepository();

function getTransactionRepository() {
  return transactionRepository;
}

function setTransactionRepository(repo) {
  transactionRepository = repo;
}

module.exports = { getTransactionRepository, setTransactionRepository };
