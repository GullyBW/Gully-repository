'use strict';

/** In-memory message store for tests / no-DB runs. */
class MemoryMessageRepository {
  constructor() {
    this.store = new Map(); // id -> message
  }

  async create(m) {
    this.store.set(m.id, { ...m, readBy: [...m.readBy] });
    return { ...m, readBy: [...m.readBy] };
  }

  async listByConversation(conversationId, { limit = 100 } = {}) {
    return [...this.store.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-limit)
      .map((m) => ({ ...m, readBy: [...m.readBy] }));
  }

  async markRead(conversationId, userId) {
    for (const m of this.store.values()) {
      if (m.conversationId === conversationId && !m.readBy.includes(userId)) {
        m.readBy.push(userId);
      }
    }
  }

  async clear() {
    this.store.clear();
  }
}

module.exports = MemoryMessageRepository;
