'use strict';

const Availability = require('../models/availability.model');

/** MongoDB-backed availability store (production). Returns plain objects. */
class MongoAvailabilityRepository {
  async findByProvider(providerId) {
    return Availability.findOne({ providerId }).lean();
  }

  async save(availability) {
    return Availability.findOneAndUpdate(
      { providerId: availability.providerId },
      { $set: availability },
      { new: true, upsert: true }
    ).lean();
  }
}

module.exports = MongoAvailabilityRepository;
