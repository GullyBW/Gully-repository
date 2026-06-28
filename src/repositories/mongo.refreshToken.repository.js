'use strict';

const RefreshToken = require('../models/refreshToken.model');

/** MongoDB-backed refresh-token store (production). Returns plain objects. */
class MongoRefreshTokenRepository {
  async create(record) {
    const doc = await RefreshToken.create(record);
    return doc.toObject();
  }

  async findByHash(tokenHash) {
    return RefreshToken.findOne({ tokenHash }).lean();
  }

  async save(record) {
    return RefreshToken.findOneAndUpdate({ id: record.id }, { $set: record }, { new: true }).lean();
  }

  async listByUser(userId) {
    return RefreshToken.find({ userId }).sort({ createdAt: -1 }).lean();
  }

  async revokeById(id) {
    const res = await RefreshToken.updateOne({ id }, { $set: { revoked: true } });
    return res.modifiedCount > 0;
  }

  async revokeAllForUser(userId) {
    await RefreshToken.updateMany({ userId }, { $set: { revoked: true } });
  }
}

module.exports = MongoRefreshTokenRepository;
