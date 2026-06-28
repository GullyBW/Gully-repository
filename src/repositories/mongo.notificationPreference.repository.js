'use strict';

const NotificationPreference = require('../models/notificationPreference.model');

/** MongoDB-backed notification-preference store (production). */
class MongoNotificationPreferenceRepository {
  async findByUser(userId) {
    return NotificationPreference.findOne({ userId }).lean();
  }

  async save(pref) {
    return NotificationPreference.findOneAndUpdate(
      { userId: pref.userId },
      { $set: pref },
      { new: true, upsert: true }
    ).lean();
  }
}

module.exports = MongoNotificationPreferenceRepository;
