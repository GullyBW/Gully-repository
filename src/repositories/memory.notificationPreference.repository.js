'use strict';

/** In-memory notification-preference store for tests / no-DB runs. */
class MemoryNotificationPreferenceRepository {
  constructor() {
    this.store = new Map(); // userId -> pref
  }

  async findByUser(userId) {
    const p = this.store.get(userId);
    return p ? { ...p, categories: { ...p.categories } } : null;
  }

  async save(pref) {
    this.store.set(pref.userId, { ...pref, categories: { ...pref.categories } });
    return { ...pref, categories: { ...pref.categories } };
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryNotificationPreferenceRepository;
