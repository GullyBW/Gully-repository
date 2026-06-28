'use strict';

/** In-memory review store for tests / no-DB runs. */
class MemoryReviewRepository {
  constructor() {
    this.store = new Map(); // id -> review
  }

  async create(review) {
    this.store.set(review.id, { ...review });
    return { ...review };
  }

  async findById(id) {
    const r = this.store.get(id);
    return r ? { ...r } : null;
  }

  async findByBooking(bookingReference) {
    const r = [...this.store.values()].find((x) => x.bookingReference === bookingReference);
    return r ? { ...r } : null;
  }

  async save(review) {
    this.store.set(review.id, { ...review });
    return { ...review };
  }

  async listByProvider(providerId, { limit = 20 } = {}) {
    return [...this.store.values()]
      .filter((r) => r.providerId === providerId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async listByStatus(status, { limit = 100 } = {}) {
    return [...this.store.values()]
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async listByCustomer(customerId, { limit = 100 } = {}) {
    return [...this.store.values()]
      .filter((r) => r.customerId === customerId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryReviewRepository;
