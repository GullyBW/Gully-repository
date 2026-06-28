'use strict';

const { v4: uuidv4 } = require('uuid');

/** An immutable record of a security-relevant event. */
function createAuditEntry({ action, actorId, targetId, ip, meta }) {
  return {
    id: uuidv4(),
    action,
    actorId: actorId || null,
    targetId: targetId || null,
    ip: ip || '',
    meta: meta || {},
    createdAt: new Date(),
  };
}

function toPublicJSON(e) {
  return {
    id: e.id,
    action: e.action,
    actorId: e.actorId,
    targetId: e.targetId,
    ip: e.ip,
    meta: e.meta,
    createdAt: e.createdAt,
  };
}

module.exports = { createAuditEntry, toPublicJSON };
