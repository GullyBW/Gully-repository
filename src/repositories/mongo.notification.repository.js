'use strict';

const Notification = require('../models/notification.model');

/** MongoDB-backed notification store (production). Returns plain objects. */
class MongoNotificationRepository {
  async create(notification) {
    const doc = await Notification.create(notification);
    return doc.toObject();
  }

  async findById(id) {
    return Notification.findOne({ id }).lean();
  }

  async save(notification) {
    return Notification.findOneAndUpdate(
      { id: notification.id },
      { $set: notification },
      { new: true }
    ).lean();
  }

  async listByUser(userId, { limit = 50, unreadOnly = false } = {}) {
    const query = { userId };
    if (unreadOnly) query.read = false;
    return Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 200))
      .lean();
  }

  async countUnread(userId) {
    return Notification.countDocuments({ userId, read: false });
  }

  async markAllRead(userId) {
    await Notification.updateMany({ userId, read: false }, { $set: { read: true } });
  }
}

module.exports = MongoNotificationRepository;
