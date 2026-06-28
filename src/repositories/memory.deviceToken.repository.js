'use strict';

/** In-memory device-token store for tests / no-DB runs. */
class MemoryDeviceTokenRepository {
  constructor() {
    this.store = new Map(); // token -> record
  }

  async upsert(record) {
    const existing = this.store.get(record.token);
    if (existing) {
      existing.lastSeenAt = new Date();
      existing.userId = record.userId;
      existing.platform = record.platform;
      return { ...existing };
    }
    this.store.set(record.token, { ...record });
    return { ...record };
  }

  async listByUser(userId) {
    return [...this.store.values()].filter((d) => d.userId === userId).map((d) => ({ ...d }));
  }

  async removeByToken(token) {
    return this.store.delete(token);
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryDeviceTokenRepository;
