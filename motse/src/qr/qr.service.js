'use strict';

const crypto = require('crypto');
const { id, hmac, timingSafeEqual } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * QR Code Platform (Phase 5, WS21). QR codes are a first-class, reusable
 * platform capability — not a payment feature — used across payments,
 * identity, tourism, heritage, governance, trusts, learning and the wallet.
 *
 * Every QR is a compact, HMAC-signed token `base64url(payload).signature`
 * (JWT-like). Security properties: cryptographic signature (tamper
 * detection), expiry, revocation, replay protection (single-use), tenant
 * isolation, permission validation, and full audit + fraud + analytics +
 * event instrumentation on every scan. Offline verification checks the
 * signature + expiry without server state; revocation and replay require
 * the server (documented limitation, matching real signed-token systems).
 *
 * The platform stores QR *metadata* (never anything that lets an attacker
 * forge a code); the signing secret lives in the SecretManager and rotates.
 */
const QR_KINDS = [
  'payment', 'identity', 'tourism', 'heritage', 'governance', 'trust', 'learning', 'wallet', 'access',
];

class QrService {
  constructor({ store, clock, secrets, audit, bus, fraud, analytics, identity, payments, cards }) {
    this.codes = store.collection('qr_codes');
    this.scans = store.collection('qr_scans');
    this.clock = clock;
    this.secrets = secrets;
    this.audit = audit;
    this.bus = bus;
    this.fraud = fraud;
    this.analytics = analytics;
    this.identity = identity;
    this.payments = payments;
    this.cards = cards;

    this.secretName = 'qr:signing';
    secrets.seed(this.secretName, `qr-signing-${crypto.randomBytes(16).toString('hex')}`);

    bus.register('qr.generated', 1, ['qr_id', 'kind']);
    bus.register('qr.scanned', 1, ['qr_id', 'kind']);
    bus.register('qr.revoked', 1, ['qr_id']);
    bus.register('qr.rejected', 1, ['reason']);

    this._registerFraud();
  }

  static kinds() {
    return [...QR_KINDS];
  }

  // ── Generation (WS21: dynamic/static, amount-embedded, invoice, etc.) ─

  generate(actorRef, {
    kind, tenant = 'motse', subjectRef = null, ref = null, amountMinor = null, currency = null,
    expiresInMs = null, singleUse = false, dynamic = false, visibility = 'public',
    requiredRole = null, requiredLevel = null, data = {}, restricted = {},
  } = {}) {
    if (!QR_KINDS.includes(kind)) throw err('INVALID_ARGUMENT', `Unknown QR kind ${kind}`);
    if (amountMinor != null && (!Number.isInteger(amountMinor) || amountMinor < 0)) {
      throw err('INVALID_ARGUMENT', 'amount_minor must be a non-negative integer');
    }
    const qrId = id('qr');
    const iat = this.clock.nowMs();
    const exp = expiresInMs != null ? iat + expiresInMs : null;
    const nonce = crypto.randomBytes(9).toString('hex');
    const token = this._sign({
      v: 1, id: qrId, k: kind, t: tenant, sub: subjectRef, ref, amt: amountMinor, cur: currency,
      iat, exp, n: nonce, s: singleUse ? 1 : 0, d: dynamic ? 1 : 0, data,
    });
    this.codes.insert({
      id: qrId, kind, tenant, subject_ref: subjectRef, ref, amount_minor: amountMinor, currency,
      single_use: !!singleUse, dynamic: !!dynamic, visibility, required_role: requiredRole, required_level: requiredLevel,
      nonce, data, restricted, issued_by: actorRef || 'system', issued_at: this.clock.nowIso(),
      expires_at: exp != null ? new Date(exp).toISOString() : null,
      state: 'active', scans: 0, last_scanned_at: null,
    });
    this.audit.append(actorRef || 'system', 'qr.generated', `qr:${qrId}`, null, { kind, tenant, single_use: !!singleUse });
    this.bus.publish('qr.generated', { qr_id: qrId, kind, tenant, stream_id: `qr:${qrId}` });
    this.analytics._bump(`qr.generated.${kind}`);
    return { qr_id: qrId, kind, token, expires_at: exp != null ? new Date(exp).toISOString() : null };
  }

  /** Batch generation for printing (WS21 admin). */
  bulkGenerate(actorRef, items = []) {
    return items.map((item) => this.generate(actorRef, item));
  }

  // ── Decode / verify ─────────────────────────────────────────────────

  /** Decode structure WITHOUT verifying — never trust this output. */
  decode(token) {
    const [body] = String(token).split('.');
    try {
      return this._expand(JSON.parse(b64urlDecode(body)));
    } catch (e) {
      throw err('INVALID_ARGUMENT', 'Malformed QR token');
    }
  }

  /**
   * Full verification: signature (tamper), expiry, revocation, replay
   * (single-use), tenant isolation, amount match and permission. Records
   * the scan and emits audit + event + analytics + fraud on every outcome.
   */
  verify(token, { scannerRef = null, tenant = null, amountMinor = null } = {}) {
    let payload;
    try {
      payload = this._verifySignature(token);
    } catch (e) {
      return this._reject('bad_signature', null, scannerRef);
    }
    const now = this.clock.nowMs();
    const code = this.codes.get(payload.id);
    if (!code) return this._reject('unknown', payload.id, scannerRef);
    if (payload.exp != null && now > payload.exp) return this._reject('expired', code.id, scannerRef);
    if (code.state === 'revoked') return this._reject('revoked', code.id, scannerRef);
    if (code.single_use && code.scans > 0) return this._reject('already_used', code.id, scannerRef);
    if (tenant && code.tenant !== tenant) return this._reject('cross_tenant', code.id, scannerRef);
    if (amountMinor != null && code.amount_minor != null && amountMinor !== code.amount_minor) {
      return this._reject('amount_mismatch', code.id, scannerRef);
    }

    // Fraud: abusive scanning is blocked before the scan is honoured.
    try {
      this.fraud.assess({
        kind: 'qr_scan', actorRef: scannerRef || 'anonymous', amountMinor: code.amount_minor || 0,
        subjectRef: code.subject_ref, qr_id: code.id,
      });
    } catch (e) {
      if (e.code === 'PERMISSION_DENIED') return this._reject('fraud_block', code.id, scannerRef);
      throw e;
    }

    // Permission validation — restricted content shows only to authorized scanners.
    const authorized = this._authorized(code, scannerRef);

    this.codes.update(code.id, { scans: code.scans + 1, last_scanned_at: this.clock.nowIso() });
    this.scans.insert({
      id: id('qsc'), qr_id: code.id, kind: code.kind, scanner_ref: scannerRef || null,
      outcome: 'valid', authorized, at: this.clock.nowIso(),
    });
    this.audit.append(scannerRef || 'anonymous', 'qr.scanned', `qr:${code.id}`, null, { kind: code.kind, authorized });
    this.bus.publish('qr.scanned', { qr_id: code.id, kind: code.kind, tenant: code.tenant, stream_id: `qr:${code.id}` });
    this.analytics._bump(`qr.scanned.${code.kind}`);

    return {
      valid: true, qr_id: code.id, kind: code.kind, tenant: code.tenant,
      subject_ref: code.subject_ref, ref: code.ref, amount_minor: code.amount_minor, currency: code.currency,
      data: code.data, restricted: authorized ? code.restricted : null, authorized,
      single_use: code.single_use, dynamic: code.dynamic,
    };
  }

  /** Offline verification (no server state): signature + expiry only. */
  static verifyOffline(secret, token, nowMs = null) {
    const parts = String(token).split('.');
    if (parts.length !== 2) return { valid: false, reason: 'malformed' };
    const [body, sig] = parts;
    if (!timingSafeEqual(hmac(secret, body), sig)) return { valid: false, reason: 'bad_signature' };
    let p;
    try { p = JSON.parse(b64urlDecode(body)); } catch (e) { return { valid: false, reason: 'malformed' }; }
    if (p.exp != null && nowMs != null && nowMs > p.exp) return { valid: false, reason: 'expired' };
    return { valid: true, qr_id: p.id, kind: p.k, amount_minor: p.amt, currency: p.cur, subject_ref: p.sub, ref: p.ref };
  }

  // ── Revocation ──────────────────────────────────────────────────────

  revoke(actorRef, qrId, reason = 'revoked') {
    const code = this._code(qrId);
    if (code.state === 'revoked') return this._publicCode(code);
    this.codes.update(qrId, { state: 'revoked', revoked_at: this.clock.nowIso(), revoked_reason: reason });
    this.audit.append(actorRef, 'qr.revoked', `qr:${qrId}`, null, { reason });
    this.bus.publish('qr.revoked', { qr_id: qrId, stream_id: `qr:${qrId}` });
    this.analytics._bump('qr.revoked');
    return this._publicCode(this.codes.get(qrId));
  }

  // ── Payment QR (WS21 payments) ──────────────────────────────────────

  /**
   * Pay by scanning a payment QR. The QR's `ref` is the destination
   * (merchant) account; `amount_minor`/`currency` are embedded. Routes to
   * cards (cardId) or a mobile-money/PayPal provider — reusing the existing
   * payment rails, so the Ledger stays the source of truth.
   */
  payWithQr(actorRef, token, { provider, msisdn, cardId, idempotencyKey } = {}) {
    const v = this.verify(token, { scannerRef: actorRef });
    if (!v.valid) throw err('STATE_CONFLICT', `QR not payable: ${v.reason}`, { reason: v.reason });
    if (v.kind !== 'payment') throw err('INVALID_ARGUMENT', 'Not a payment QR');
    if (v.amount_minor == null) throw err('INVALID_ARGUMENT', 'Payment QR carries no amount');
    if (!v.ref) throw err('INVALID_ARGUMENT', 'Payment QR carries no destination account');
    const key = idempotencyKey || `qrpay:${v.qr_id}:${actorRef}`;
    if (cardId) {
      return this.cards.createIntent(actorRef, {
        amountMinor: v.amount_minor, currency: v.currency || 'BWP', destAccountId: v.ref, cardId,
        ref: `qr:${v.qr_id}`, idempotencyKey: key,
      });
    }
    return this.payments.collect({
      provider: provider || 'orange_money', msisdn, amountMinor: v.amount_minor, currency: v.currency || 'BWP',
      destAccountId: v.ref, purposeRef: `qr:${v.qr_id}`, actorRef, idempotencyKey: key,
    });
  }

  // ── Admin / reporting (WS21) ────────────────────────────────────────

  list(filter = {}) {
    return this.codes
      .find((c) =>
        (filter.kind ? c.kind === filter.kind : true) &&
        (filter.tenant ? c.tenant === filter.tenant : true) &&
        (filter.state ? c.state === filter.state : true))
      .map((c) => this._publicCode(c));
  }

  /** Public metadata for a single QR (never the signing material). */
  get(qrId) {
    return this._publicCode(this._code(qrId));
  }

  scanHistory(qrId) {
    return this.scans.find((s) => s.qr_id === qrId);
  }

  /** Usage analytics + security posture (WS21 admin, WS13 analytics). */
  report() {
    const codes = this.codes.find();
    const byKind = {};
    const byState = {};
    for (const c of codes) {
      byKind[c.kind] = (byKind[c.kind] || 0) + 1;
      byState[c.state] = (byState[c.state] || 0) + 1;
    }
    const scans = this.scans.find();
    const rejected = scans.filter((s) => s.outcome === 'rejected');
    const rejectionReasons = {};
    for (const s of rejected) rejectionReasons[s.reason] = (rejectionReasons[s.reason] || 0) + 1;
    return {
      total: codes.length,
      active: byState.active || 0,
      revoked: byState.revoked || 0,
      by_kind: byKind,
      by_state: byState,
      scans: scans.length,
      valid_scans: scans.length - rejected.length,
      rejected: rejected.length,
      rejection_reasons: rejectionReasons,
    };
  }

  // ── Internals ───────────────────────────────────────────────────────

  _authorized(code, scannerRef) {
    if (code.visibility !== 'restricted') return true;
    if (!scannerRef) return false;
    if (code.required_role) {
      try { this.identity.requireRole(scannerRef, code.required_role, 'platform'); } catch (e) { return false; }
    }
    if (code.required_level) {
      try { this.identity.requireLevel(scannerRef, code.required_level); } catch (e) { return false; }
    }
    return true;
  }

  _reject(reason, qrId, scannerRef) {
    this.scans.insert({
      id: id('qsc'), qr_id: qrId || null, scanner_ref: scannerRef || null, outcome: 'rejected', reason, at: this.clock.nowIso(),
    });
    this.audit.append(scannerRef || 'anonymous', 'qr.rejected', qrId ? `qr:${qrId}` : 'qr:unknown', null, { reason });
    this.bus.publish('qr.rejected', { reason, qr_id: qrId || null, stream_id: qrId ? `qr:${qrId}` : 'qr' });
    this.analytics._bump(`qr.rejected.${reason}`);
    return { valid: false, reason };
  }

  _sign(payload) {
    const body = b64url(JSON.stringify(payload));
    const sig = hmac(this.secrets.current(this.secretName).value, body);
    return `${body}.${sig}`;
  }

  _verifySignature(token) {
    const parts = String(token).split('.');
    if (parts.length !== 2) throw err('INVALID_ARGUMENT', 'Malformed QR token');
    const [body, sig] = parts;
    const versions = this.secrets.validForVerification(this.secretName);
    if (!versions.some((v) => timingSafeEqual(hmac(v.value, body), sig))) {
      throw err('PERMISSION_DENIED', 'QR signature verification failed');
    }
    const p = JSON.parse(b64urlDecode(body));
    return { ...this._expand(p), id: p.id, exp: p.exp };
  }

  _expand(p) {
    return {
      version: p.v, qr_id: p.id, kind: p.k, tenant: p.t, subject_ref: p.sub, ref: p.ref,
      amount_minor: p.amt, currency: p.cur, issued_at_ms: p.iat, expires_at_ms: p.exp,
      single_use: !!p.s, dynamic: !!p.d, data: p.data,
    };
  }

  _publicCode(c) {
    return {
      qr_id: c.id, kind: c.kind, tenant: c.tenant, subject_ref: c.subject_ref, ref: c.ref,
      amount_minor: c.amount_minor, currency: c.currency, state: c.state, scans: c.scans,
      single_use: c.single_use, dynamic: c.dynamic, visibility: c.visibility,
      issued_by: c.issued_by, issued_at: c.issued_at, expires_at: c.expires_at, last_scanned_at: c.last_scanned_at,
    };
  }

  _code(qrId) {
    const code = this.codes.get(qrId);
    if (!code) throw err('NOT_FOUND', `No QR ${qrId}`);
    return code;
  }

  _registerFraud() {
    this.fraud.register('qr_scan_velocity', (ctx, engine) => {
      if (ctx.kind !== 'qr_scan' || !ctx.actorRef || ctx.actorRef === 'anonymous') return null;
      const windowStart = engine.clock.nowMs() - 60 * 1000;
      const recent = (engine._history || []).filter(
        (h) => h.actorRef === ctx.actorRef && h.kind === 'qr_scan' && h.at >= windowStart
      );
      if (recent.length >= 30) return { action: 'deny', detail: 'excessive QR scanning' };
      if (recent.length >= 15) return { action: 'review', detail: 'high QR scan rate' };
      return null;
    });
  }
}

function b64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

module.exports = { QrService, QR_KINDS };
