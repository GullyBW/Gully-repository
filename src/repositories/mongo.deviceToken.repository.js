'use strict';

const DeviceToken = require('../models/deviceToken.model');

/** MongoDB-backed device-token store (production). Returns plain objects. */
class MongoDeviceTokenRepository {
  async upsert(record) {
    return DeviceToken.findOneAndUpdate(
      { token: record.token },
      { $set: { userId: record.userId, platform: record.platform, lastSeenAt: new Date() }, $setOnInsert: { id: record.id, createdAt: record.createdAt } },
      { new: true, upsert: true }
    ).lean();
  }

  async listByUser(userId) {
    return DeviceToken.find({ userId }).lean();
  }

  async removeByToken(token) {
    const res = await DeviceToken.deleteOne({ token });
    return res.deletedCount > 0;
  }
}

module.exports = MongoDeviceTokenRepository;
