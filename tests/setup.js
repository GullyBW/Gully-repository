'use strict';

const { setTransactionRepository } = require('../src/repositories');
const MemoryTransactionRepository = require('../src/repositories/memory.transaction.repository');

// Run the whole suite against the in-memory store so no MongoDB is required.
const repo = new MemoryTransactionRepository();
setTransactionRepository(repo);

afterEach(async () => {
  await repo.clear();
});
