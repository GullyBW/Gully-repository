'use strict';

/** In-memory availability store for tests / no-DB runs. */
class MemoryAvailabilityRepository {
  constructor() {
    this.store = new Map(); // providerId -> availability
  }

  async findByProvider(providerId) {
    const a = this.store.get(providerId);
    return a ? { ...a } : null;
  }

  async save(availability) {
    this.store.set(availability.providerId, { ...availability });
    return { ...availability };
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryAvailabilityRepository;
