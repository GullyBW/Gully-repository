'use strict';

const Provider = require('../models/provider.model');

/** MongoDB-backed provider store (production). Returns plain objects. */
class MongoProviderRepository {
  async create(provider) {
    const doc = await Provider.create(provider);
    return doc.toObject();
  }

  async findByUserId(userId) {
    return Provider.findOne({ userId }).lean();
  }

  async save(provider) {
    return Provider.findOneAndUpdate(
      { userId: provider.userId },
      { $set: provider },
      { new: true, upsert: true }
    ).lean();
  }

  /** Push the cheap filters into the query; ranking/distance happen in the service. */
  async query(filter = {}) {
    const mongoQuery = {};
    if (filter.category) mongoQuery.categories = filter.category;
    if (filter.verifiedOnly) mongoQuery.verified = true;
    if (filter.availableOnly) mongoQuery.availabilityStatus = 'available';
    if (filter.minRating != null) mongoQuery.rating = { $gte: filter.minRating };
    if (filter.maxPrice != null) mongoQuery.startingPrice = { $lte: filter.maxPrice };
    if (filter.q) {
      const rx = new RegExp(escapeRegExp(filter.q), 'i');
      mongoQuery.$or = [{ businessName: rx }, { fullName: rx }, { bio: rx }];
    }
    // Cap to a sane upper bound; ranking + pagination is applied downstream.
    return Provider.find(mongoQuery).limit(500).lean();
  }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = MongoProviderRepository;
