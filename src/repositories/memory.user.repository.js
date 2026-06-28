'use strict';

/** In-memory user store for tests / no-DB runs. */
class MemoryUserRepository {
  constructor() {
    this.store = new Map(); // id -> user
  }

  async create(user) {
    this.store.set(user.id, { ...user });
    return { ...user };
  }

  async findById(id) {
    const u = this.store.get(id);
    return u ? { ...u } : null;
  }

  async findByEmail(email) {
    const target = String(email).toLowerCase();
    const found = [...this.store.values()].find((u) => u.email === target);
    return found ? { ...found } : null;
  }

  async save(user) {
    this.store.set(user.id, { ...user });
    return { ...user };
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryUserRepository;
