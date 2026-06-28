'use strict';

const Booking = require('../models/booking.model');

/** MongoDB-backed booking store (production). Returns plain objects. */
class MongoBookingRepository {
  async create(booking) {
    const doc = await Booking.create(booking);
    return doc.toObject();
  }

  async findByReference(reference) {
    return Booking.findOne({ reference }).lean();
  }

  async save(booking) {
    return Booking.findOneAndUpdate(
      { reference: booking.reference },
      { $set: booking },
      { new: true, upsert: true }
    ).lean();
  }

  async listByCustomer(customerId, { limit = 20 } = {}) {
    return Booking.find({ customerId })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();
  }

  async listByProvider(providerId, { limit = 20 } = {}) {
    return Booking.find({ providerId })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();
  }

  async query({ status, limit = 100 } = {}) {
    const q = {};
    if (status) q.status = status;
    return Booking.find(q).sort({ createdAt: -1 }).limit(Math.min(limit, 500)).lean();
  }

  async all() {
    return Booking.find({}).lean();
  }

  async countByStatus(status) {
    return Booking.countDocuments(status ? { status } : {});
  }
}

module.exports = MongoBookingRepository;
