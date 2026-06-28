'use strict';

const SavedAddress = require('../models/savedAddress.model');

/** MongoDB-backed saved-address store (production). Returns plain objects. */
class MongoSavedAddressRepository {
  async create(addr) {
    const doc = await SavedAddress.create(addr);
    return doc.toObject();
  }

  async findById(id) {
    return SavedAddress.findOne({ id }).lean();
  }

  async listByCustomer(customerId) {
    return SavedAddress.find({ customerId }).sort({ createdAt: -1 }).lean();
  }

  async save(addr) {
    return SavedAddress.findOneAndUpdate({ id: addr.id }, { $set: addr }, { new: true }).lean();
  }

  async remove(id) {
    const res = await SavedAddress.deleteOne({ id });
    return res.deletedCount > 0;
  }

  async clearDefault(customerId) {
    await SavedAddress.updateMany({ customerId }, { $set: { isDefault: false } });
  }
}

module.exports = MongoSavedAddressRepository;
