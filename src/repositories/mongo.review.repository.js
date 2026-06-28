'use strict';

const Review = require('../models/review.model');

/** MongoDB-backed review store (production). Returns plain objects. */
class MongoReviewRepository {
  async create(review) {
    const doc = await Review.create(review);
    return doc.toObject();
  }

  async findById(id) {
    return Review.findOne({ id }).lean();
  }

  async findByBooking(bookingReference) {
    return Review.findOne({ bookingReference }).lean();
  }

  async save(review) {
    return Review.findOneAndUpdate({ id: review.id }, { $set: review }, { new: true }).lean();
  }

  async listByProvider(providerId, { limit = 20 } = {}) {
    return Review.find({ providerId })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 10000))
      .lean();
  }

  async listByStatus(status, { limit = 100 } = {}) {
    return Review.find(status ? { status } : {})
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 1000))
      .lean();
  }

  async listByCustomer(customerId, { limit = 100 } = {}) {
    return Review.find({ customerId })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 1000))
      .lean();
  }
}

module.exports = MongoReviewRepository;
