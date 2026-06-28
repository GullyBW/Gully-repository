'use strict';

/** In-memory conversation store for tests / no-DB runs. */
class MemoryConversationRepository {
  constructor() {
    this.store = new Map(); // id -> conversation
  }

  async create(c) {
    this.store.set(c.id, { ...c });
    return { ...c };
  }

  async findByBooking(bookingReference) {
    const c = [...this.store.values()].find((x) => x.bookingReference === bookingReference);
    return c ? { ...c } : null;
  }

  async findById(id) {
    const c = this.store.get(id);
    return c ? { ...c } : null;
  }

  async save(c) {
    this.store.set(c.id, { ...c });
    return { ...c };
  }

  async listByParticipant(userId) {
    return [...this.store.values()]
      .filter((c) => c.customerId === userId || c.providerId === userId)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
      .map((c) => ({ ...c }));
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryConversationRepository;
