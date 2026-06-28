'use strict';

const Message = require('../models/message.model');

/** MongoDB-backed message store (production). Returns plain objects. */
class MongoMessageRepository {
  async create(m) {
    const doc = await Message.create(m);
    return doc.toObject();
  }

  async listByConversation(conversationId, { limit = 100 } = {}) {
    const docs = await Message.find({ conversationId })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 200))
      .lean();
    return docs.reverse();
  }

  async markRead(conversationId, userId) {
    await Message.updateMany(
      { conversationId, readBy: { $ne: userId } },
      { $push: { readBy: userId } }
    );
  }
}

module.exports = MongoMessageRepository;
