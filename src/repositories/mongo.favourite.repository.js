'use strict';

const Favourite = require('../models/favourite.model');

/** MongoDB-backed favourites store (production). Returns plain objects. */
class MongoFavouriteRepository {
  async create(fav) {
    const doc = await Favourite.create(fav);
    return doc.toObject();
  }

  async find(customerId, providerId) {
    return Favourite.findOne({ customerId, providerId }).lean();
  }

  async listByCustomer(customerId) {
    return Favourite.find({ customerId }).sort({ createdAt: -1 }).lean();
  }

  async remove(customerId, providerId) {
    const res = await Favourite.deleteOne({ customerId, providerId });
    return res.deletedCount > 0;
  }
}

module.exports = MongoFavouriteRepository;
