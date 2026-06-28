'use strict';

/** In-memory booking store for tests / no-DB runs. */
class MemoryBookingRepository {
  constructor() {
    this.store = new Map(); // reference -> booking
  }

  async create(booking) {
    this.store.set(booking.reference, { ...booking });
    return { ...booking };
  }

  async findByReference(reference) {
    const b = this.store.get(reference);
    return b ? { ...b } : null;
  }

  async save(booking) {
    this.store.set(booking.reference, { ...booking });
    return { ...booking };
  }

  async listByCustomer(customerId, { limit = 20 } = {}) {
    return this._listBy('customerId', customerId, limit);
  }

  async listByProvider(providerId, { limit = 20 } = {}) {
    return this._listBy('providerId', providerId, limit);
  }

  /** Cross-cutting query for admin/analytics. */
  async query({ status, limit = 100 } = {}) {
    return [...this.store.values()]
      .filter((b) => !status || b.status === status)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((b) => ({ ...b }));
  }

  async all() {
    return [...this.store.values()].map((b) => ({ ...b }));
  }

  async countByStatus(status) {
    return [...this.store.values()].filter((b) => !status || b.status === status).length;
  }

  _listBy(field, value, limit) {
    return [...this.store.values()]
      .filter((b) => b[field] === value)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((b) => ({ ...b }));
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryBookingRepository;
