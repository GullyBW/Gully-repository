'use strict';

/** In-memory notification store for tests / no-DB runs. */
class MemoryNotificationRepository {
  constructor() {
    this.store = new Map(); // id -> notification
  }

  async create(notification) {
    this.store.set(notification.id, { ...notification });
    return { ...notification };
  }

  async findById(id) {
    const n = this.store.get(id);
    return n ? { ...n } : null;
  }

  async save(notification) {
    this.store.set(notification.id, { ...notification });
    return { ...notification };
  }

  async listByUser(userId, { limit = 50, unreadOnly = false } = {}) {
    return [...this.store.values()]
      .filter((n) => n.userId === userId && (!unreadOnly || !n.read))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((n) => ({ ...n }));
  }

  async countUnread(userId) {
    return [...this.store.values()].filter((n) => n.userId === userId && !n.read).length;
  }

  async markAllRead(userId) {
    for (const n of this.store.values()) {
      if (n.userId === userId) n.read = true;
    }
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryNotificationRepository;
