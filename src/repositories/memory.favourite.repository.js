'use strict';

/** In-memory favourites store for tests / no-DB runs. */
class MemoryFavouriteRepository {
  constructor() {
    this.store = new Map(); // id -> favourite
  }

  async create(fav) {
    this.store.set(fav.id, { ...fav });
    return { ...fav };
  }

  async find(customerId, providerId) {
    const f = [...this.store.values()].find(
      (x) => x.customerId === customerId && x.providerId === providerId
    );
    return f ? { ...f } : null;
  }

  async listByCustomer(customerId) {
    return [...this.store.values()]
      .filter((f) => f.customerId === customerId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((f) => ({ ...f }));
  }

  async remove(customerId, providerId) {
    const f = [...this.store.values()].find(
      (x) => x.customerId === customerId && x.providerId === providerId
    );
    if (f) this.store.delete(f.id);
    return !!f;
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryFavouriteRepository;
