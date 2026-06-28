'use strict';

const Conversation = require('../models/conversation.model');

/** MongoDB-backed conversation store (production). Returns plain objects. */
class MongoConversationRepository {
  async create(c) {
    const doc = await Conversation.create(c);
    return doc.toObject();
  }

  async findByBooking(bookingReference) {
    return Conversation.findOne({ bookingReference }).lean();
  }

  async findById(id) {
    return Conversation.findOne({ id }).lean();
  }

  async save(c) {
    return Conversation.findOneAndUpdate({ id: c.id }, { $set: c }, { new: true }).lean();
  }

  async listByParticipant(userId) {
    return Conversation.find({ $or: [{ customerId: userId }, { providerId: userId }] })
      .sort({ lastMessageAt: -1 })
      .lean();
  }
}

module.exports = MongoConversationRepository;
