'use strict';
// Zero Trust (Phase 19) + risk-based / continuous authorization (Phase 12). No actor is
// trusted by position; every sensitive action is re-evaluated against a live TRUST SCORE
// derived from signals (MFA assurance, device trust, geography, recency of auth, risk).
// Deterministic and side-effect-free.
//
// Break-glass emergency access is time-boxed, justification-bound, and heavily audited — it
// grants nothing silently and never bypasses the audit trail.

// Weighted trust score in [0,100] from non-identifying signals.
function trustScore({ mfa, deviceTrusted = false, geoAllowed = true, freshAuthMs = 0, maxFreshMs = 3600_000, riskLevel = 'low' } = {}) {
  let score = 0; const breakdown = {};
  breakdown.mfa = mfa === 'fido2' ? 40 : mfa === 'otp' ? 20 : 0;
  breakdown.device = deviceTrusted ? 25 : 0;
  breakdown.geo = geoAllowed ? 15 : 0;
  breakdown.freshness = freshAuthMs <= maxFreshMs ? 15 : Math.max(0, 15 - Math.floor((freshAuthMs - maxFreshMs) / maxFreshMs) * 5);
  const riskPenalty = { low: 0, medium: 10, high: 25, critical: 40 }[riskLevel] ?? 0;
  breakdown.riskPenalty = -riskPenalty;
  score = breakdown.mfa + breakdown.device + breakdown.geo + breakdown.freshness - riskPenalty;
  return { score: Math.max(0, Math.min(100, score)), breakdown };
}

// Continuous authorization: a sensitive action needs a higher trust floor. Below the floor
// but close → step-up (re-authenticate); far below → deny. Never implicitly allow.
const SENSITIVE = new Set(['read-evidence', 'admit-evidence', 'record-governance-decision', 'break-glass', 'cross-agency-share']);
function continuousAuthz({ action, score, floor }) {
  const required = floor ?? (SENSITIVE.has(action) ? 80 : 50);
  if (score >= required) return { decision: 'allow', required, score };
  if (score >= required - 20) return { decision: 'step-up', required, score, reason: 'trust below floor — re-verify (MFA/device)' };
  return { decision: 'deny', required, score, reason: 'trust far below floor' };
}

// Device trust registry (identity-free: devices keyed by an opaque device id).
class DeviceRegistry {
  constructor() { this._devices = new Map(); }
  register(deviceId, { trusted = false, posture = {} } = {}) { this._devices.set(deviceId, { trusted, posture }); return this; }
  isTrusted(deviceId) { const d = this._devices.get(deviceId); return !!(d && d.trusted); }
  revoke(deviceId) { const d = this._devices.get(deviceId); if (d) d.trusted = false; return !!d; }
}

// Break-glass emergency access: time-boxed, justification-bound, audited grant.
class BreakGlass {
  constructor({ clock = () => Date.now(), ttlMs = 900_000 } = {}) { this._clock = clock; this._ttl = ttlMs; this._grants = new Map(); this._seq = 0; }
  request({ principal, justification, approver }) {
    if (!principal || !justification || !approver) throw new Error('break-glass requires principal, justification, and a distinct human approver');
    if (approver === principal) throw new Error('break-glass approver must differ from the requester (separation of duties)');
    const id = 'BG-' + (++this._seq).toString().padStart(4, '0');
    const grant = { id, principal, approver, justification, grantedAt: this._clock(), expiresAt: this._clock() + this._ttl, active: true };
    this._grants.set(id, grant);
    return { ...grant };
  }
  active(id) { const g = this._grants.get(id); return !!(g && g.active && g.expiresAt > this._clock()); }
  revoke(id) { const g = this._grants.get(id); if (g) g.active = false; return !!g; }
  ledger() { return [...this._grants.values()].map((g) => ({ id: g.id, principal: g.principal, approver: g.approver, grantedAt: g.grantedAt, expiresAt: g.expiresAt, active: g.active })); }
}

module.exports = { trustScore, continuousAuthz, SENSITIVE, DeviceRegistry, BreakGlass };
