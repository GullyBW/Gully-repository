'use strict';

const AuditLog = require('../models/auditLog.model');

/** MongoDB-backed audit-log store (production). Returns plain objects. */
class MongoAuditLogRepository {
  async create(entry) {
    const doc = await AuditLog.create(entry);
    return doc.toObject();
  }

  async list({ action, actorId, limit = 100 } = {}) {
    const query = {};
    if (action) query.action = action;
    if (actorId) query.actorId = actorId;
    return AuditLog.find(query).sort({ createdAt: -1 }).limit(Math.min(limit, 1000)).lean();
  }
}

module.exports = MongoAuditLogRepository;
