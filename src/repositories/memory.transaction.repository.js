'use strict';

/**
 * In-memory transaction store. Used by the test suite and for local smoke runs
 * without a MongoDB. Implements the same contract as the Mongo repository.
 */
class MemoryTransactionRepository {
  constructor() {
    this.store = new Map(); // reference -> transaction object
  }

  async create(txn) {
    this.store.set(txn.reference, { ...txn });
    return { ...txn };
  }

  async findByReference(reference) {
    const found = this.store.get(reference);
    return found ? { ...found } : null;
  }

  async save(txn) {
    this.store.set(txn.reference, { ...txn });
    return { ...txn };
  }

  async listByCustomer(customerId, { limit = 20 } = {}) {
    return [...this.store.values()]
      .filter((t) => t.customerId === customerId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryTransactionRepository;
