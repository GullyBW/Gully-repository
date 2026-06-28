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

  async findByEmailVerificationToken(token) {
    return User.findOne({ emailVerificationToken: token }).lean();
  }

  async findByPasswordResetToken(token) {
    return User.findOne({ passwordResetToken: token }).lean();
  }

  async search({ q, role, limit = 50 } = {}) {
    const query = {};
    if (role) query.role = role;
    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: rx }, { email: rx }];
    }
    return User.find(query).limit(Math.min(limit, 200)).lean();
  }

  async countByRole(role) {
    return User.countDocuments({ role });
  }

  async save(user) {
    return User.findOneAndUpdate({ id: user.id }, { $set: user }, { new: true }).lean();
  }
}

module.exports = MongoUserRepository;
