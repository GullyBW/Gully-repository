'use strict';

/**
 * Canonical error codes (engineering doc, Appendix B) and the
 * problem-details envelope used on every error response (§7.1):
 *   { code, message, domain_reason, retryable, trace_id }
 */

const CODES = {
  AUTH_LEVEL_REQUIRED: {
    status: 403,
    retryable: false,
    message: 'Actor below required verification level',
  },
  MEMBERSHIP_REQUIRED: {
    status: 403,
    retryable: false,
    message: 'Restricted content; morafe membership not attested',
  },
  IDEMPOTENT_REPLAY: {
    status: 200,
    retryable: false,
    message: 'Duplicate Idempotency-Key; original result returned',
  },
  LEDGER_IMBALANCE_REJECTED: {
    status: 422,
    retryable: false,
    message: 'Posting set does not sum to zero',
  },
  ESCROW_RELEASE_BLOCKED: {
    status: 409,
    retryable: false,
    message: 'Milestone evidence/approvals incomplete or campaign frozen',
  },
  CONSENT_MISSING: {
    status: 422,
    retryable: false,
    message: 'Contribution lacks a valid ConsentRecord',
  },
  PACK_SIGNATURE_INVALID: {
    status: 409,
    retryable: true,
    message: 'Offline pack failed verification; re-download required',
  },
  SEAT_FROZEN: {
    status: 409,
    retryable: false,
    message: 'Council seat suspended pending Ring 3 resolution',
  },
  // Generic platform codes
  UNAUTHENTICATED: { status: 401, retryable: false, message: 'Authentication required' },
  PERMISSION_DENIED: { status: 403, retryable: false, message: 'Actor lacks the required role for this scope' },
  NOT_FOUND: { status: 404, retryable: false, message: 'Resource not found' },
  INVALID_ARGUMENT: { status: 400, retryable: false, message: 'Invalid request' },
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, retryable: false, message: 'Mutating requests require an Idempotency-Key header' },
  STATE_CONFLICT: { status: 409, retryable: false, message: 'Operation not valid in the current state' },
  RATE_LIMITED: { status: 429, retryable: true, message: 'Too many requests' },
  MAINTENANCE: { status: 503, retryable: true, message: 'Platform is in maintenance mode' },
  UNAVAILABLE: { status: 503, retryable: true, message: 'Temporarily unavailable; rejected to protect the platform' },
  INTERNAL: { status: 500, retryable: true, message: 'Internal error' },
};

class MotseError extends Error {
  /**
   * @param {keyof typeof CODES} code
   * @param {string} [domainReason] human-readable, domain-specific detail
   * @param {object} [payload] extra machine-readable fields (e.g. required_level)
   */
  constructor(code, domainReason, payload = {}) {
    const def = CODES[code] || CODES.INTERNAL;
    super(def.message);
    this.name = 'MotseError';
    this.code = code;
    this.status = def.status;
    this.retryable = def.retryable;
    this.domainReason = domainReason || null;
    this.payload = payload;
  }

  toProblem(traceId) {
    return {
      code: this.code,
      message: this.message,
      domain_reason: this.domainReason,
      retryable: this.retryable,
      trace_id: traceId || null,
      ...this.payload,
    };
  }
}

const err = (code, domainReason, payload) => new MotseError(code, domainReason, payload);

module.exports = { CODES, MotseError, err };
