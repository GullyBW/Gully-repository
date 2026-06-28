'use strict';

/** In-memory saved-address store for tests / no-DB runs. */
class MemorySavedAddressRepository {
  constructor() {
    this.store = new Map(); // id -> address
  }

  async create(addr) {
    this.store.set(addr.id, { ...addr });
    return { ...addr };
  }

  async findById(id) {
    const a = this.store.get(id);
    return a ? { ...a } : null;
  }

  async listByCustomer(customerId) {
    return [...this.store.values()]
      .filter((a) => a.customerId === customerId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((a) => ({ ...a }));
  }

  async save(addr) {
    this.store.set(addr.id, { ...addr });
    return { ...addr };
  }

  async remove(id) {
    return this.store.delete(id);
  }

  async clearDefault(customerId) {
    for (const a of this.store.values()) {
      if (a.customerId === customerId) a.isDefault = false;
    }
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemorySavedAddressRepository;
