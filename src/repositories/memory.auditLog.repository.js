'use strict';

/** In-memory audit-log store for tests / no-DB runs. */
class MemoryAuditLogRepository {
  constructor() {
    this.store = [];
  }

  async create(entry) {
    this.store.push({ ...entry });
    return { ...entry };
  }

  async list({ action, actorId, limit = 100 } = {}) {
    return this.store
      .filter((e) => (!action || e.action === action) && (!actorId || e.actorId === actorId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  async clear() {
    this.store = [];
  }
}

module.exports = MemoryAuditLogRepository;
