'use strict';

const domain = require('../domain/auditLog');
const { getAuditLogRepository } = require('../repositories');

/**
 * Audit logging for security-relevant events (logins, token refreshes, admin
 * actions). Writes are best-effort: auditing must never break the operation it
 * records.
 */
class AuditService {
  static get repo() {
    return getAuditLogRepository();
  }

  static async log(action, { actorId, targetId, ip, meta } = {}) {
    try {
      return await AuditService.repo.create(
        domain.createAuditEntry({ action, actorId, targetId, ip, meta })
      );
    } catch (_err) {
      return null;
    }
  }

  static async list(filter = {}) {
    const entries = await AuditService.repo.list(filter);
    return entries.map(domain.toPublicJSON);
  }
}

module.exports = AuditService;
