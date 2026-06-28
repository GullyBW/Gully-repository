'use strict';

const Transaction = require('../models/transaction.model');

/**
 * MongoDB-backed transaction store (production). Returns plain objects so the
 * service layer never depends on mongoose document behaviour.
 */
class MongoTransactionRepository {
  async create(txn) {
    const doc = await Transaction.create(txn);
    return doc.toObject();
  }

  async findByReference(reference) {
    const doc = await Transaction.findOne({ reference }).lean();
    return doc || null;
  }

  async save(txn) {
    const doc = await Transaction.findOneAndUpdate(
      { reference: txn.reference },
      { $set: txn },
      { new: true, upsert: true }
    ).lean();
    return doc;
  }

  async listByCustomer(customerId, { limit = 20 } = {}) {
    return Transaction.find({ customerId })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();
  }

  async query({ status, method, limit = 100 } = {}) {
    const q = {};
    if (status) q.status = status;
    if (method) q.method = method;
    return Transaction.find(q).sort({ createdAt: -1 }).limit(Math.min(limit, 500)).lean();
  }

  async all() {
    return Transaction.find({}).lean();
  }

  async sumByStatus(status) {
    const res = await Transaction.aggregate([
      { $match: { status } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return res.length ? res[0].total : 0;
  }
}

module.exports = MongoTransactionRepository;
