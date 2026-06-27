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
}

module.exports = MongoTransactionRepository;
