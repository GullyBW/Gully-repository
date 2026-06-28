'use strict';

const User = require('../models/user.model');

/** MongoDB-backed user store (production). Returns plain objects. */
class MongoUserRepository {
  async create(user) {
    const doc = await User.create(user);
    return doc.toObject();
  }

  async findById(id) {
    return User.findOne({ id }).lean();
  }

  async findByEmail(email) {
    return User.findOne({ email: String(email).toLowerCase() }).lean();
  }

  async save(user) {
    return User.findOneAndUpdate({ id: user.id }, { $set: user }, { new: true }).lean();
  }
}

module.exports = MongoUserRepository;
