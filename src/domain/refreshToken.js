'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

/**
 * Refresh tokens enable short-lived access tokens with long-lived sessions, plus
 * rotation (each use issues a new token and revokes the old one) and device
 * management. We store only a SHA-256 hash of the token, never the raw value.
 */
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function createRefreshToken(userId, { device, ip } = {}) {
  const raw = crypto.randomBytes(48).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.auth.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  return {
    record: {
      id: uuidv4(),
      userId,
      tokenHash: hashToken(raw),
      device: device || 'unknown',
      ip: ip || '',
      revoked: false,
      createdAt: now,
      expiresAt,
      lastUsedAt: now,
    },
    raw,
  };
}

function isActive(record) {
  return !!record && !record.revoked && new Date(record.expiresAt).getTime() > Date.now();
}

function toPublicJSON(r) {
  return {
    id: r.id,
    device: r.device,
    ip: r.ip,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    revoked: r.revoked,
  };
}

module.exports = { hashToken, createRefreshToken, isActive, toPublicJSON };
