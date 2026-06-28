'use strict';

/** In-memory refresh-token store for tests / no-DB runs. */
class MemoryRefreshTokenRepository {
  constructor() {
    this.store = new Map(); // id -> record
  }

  async create(record) {
    this.store.set(record.id, { ...record });
    return { ...record };
  }

  async findByHash(tokenHash) {
    const r = [...this.store.values()].find((x) => x.tokenHash === tokenHash);
    return r ? { ...r } : null;
  }

  async save(record) {
    this.store.set(record.id, { ...record });
    return { ...record };
  }

  async listByUser(userId) {
    return [...this.store.values()]
      .filter((r) => r.userId === userId)
      .map((r) => ({ ...r }));
  }

  async revokeById(id) {
    const r = this.store.get(id);
    if (r) r.revoked = true;
    return !!r;
  }

  async revokeAllForUser(userId) {
    for (const r of this.store.values()) {
      if (r.userId === userId) r.revoked = true;
    }
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryRefreshTokenRepository;
