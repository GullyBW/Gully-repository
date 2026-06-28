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

  async findByEmailVerificationToken(token) {
    const found = [...this.store.values()].find((u) => u.emailVerificationToken === token);
    return found ? { ...found } : null;
  }

  async findByPasswordResetToken(token) {
    const found = [...this.store.values()].find((u) => u.passwordResetToken === token);
    return found ? { ...found } : null;
  }

  async search({ q, role, limit = 50 } = {}) {
    const needle = (q || '').toLowerCase();
    return [...this.store.values()]
      .filter((u) => {
        if (role && u.role !== role) return false;
        if (needle) {
          return `${u.name} ${u.email}`.toLowerCase().includes(needle);
        }
        return true;
      })
      .slice(0, limit)
      .map((u) => ({ ...u }));
  }

  async countByRole(role) {
    return [...this.store.values()].filter((u) => u.role === role).length;
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
