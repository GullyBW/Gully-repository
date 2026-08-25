'use strict';
// Confidential Reporting store (INDEPENDENT zone).
// Enforces the core promise at write time: NO reporter-identifying field may
// ever be stored (blueprint D-02, DDR-05, threats ID-1/I-1). Content is stored
// as ciphertext (envelope encryption). No IP, no device id — by construction.
const { ZONES } = require('../zones');
const { envelopeEncrypt } = require('../platform/crypto');

// Identity attributes that must NEVER appear in a report record. "omang" is the
// Botswana national identity document (public term); included as a domain-specific guard.
const IDENTITY_DENYLIST = Object.freeze([
  'name', 'fullname', 'firstname', 'lastname', 'surname',
  'nationalid', 'omang', 'idnumber', 'passport',
  'phone', 'phonenumber', 'msisdn', 'mobile',
  'email', 'ip', 'ipaddress', 'deviceid', 'device', 'fingerprint',
  'address', 'gps', 'lat', 'lon', 'dob', 'dateofbirth', 'username', 'userid',
]);

// The allowed, non-identifying schema. This is the ONLY shape the store accepts.
const ALLOWED_COLUMNS = Object.freeze([
  'case_code', 'category', 'created_at_coarse', 'content_cipher', 'content_key_ref', 'status',
]);

class IdentityMinimizationError extends Error {}

class ReportStore {
  constructor(clock) {
    this.zone = ZONES.INDEPENDENT;
    this._rows = new Map();
    this._clock = clock;
  }

  // schema() lets fitness functions statically inspect columns.
  schema() {
    return { table: 'report', zone: this.zone, columns: [...ALLOWED_COLUMNS] };
  }

  // Reject any submission carrying identity — this is the runtime guard, not just a schema note.
  _assertNoIdentity(submission) {
    for (const key of Object.keys(submission)) {
      if (IDENTITY_DENYLIST.includes(key.toLowerCase())) {
        throw new IdentityMinimizationError(`identity field rejected: ${key}`);
      }
    }
  }

  submit({ case_code, category, content }) {
    this._assertNoIdentity(arguments[0] || {});
    if (!case_code || !category) throw new Error('case_code and category required');
    const blob = envelopeEncrypt(this.zone, content == null ? '' : content);
    const row = {
      case_code,
      category,
      created_at_coarse: this._coarse(this._clock()),
      content_cipher: blob, // ciphertext object, never plaintext
      content_key_ref: blob.keyRef,
      status: 'received',
    };
    this._rows.set(case_code, row);
    return { case_code };
  }

  // Status retrieval requires ONLY the case code (no identifier).
  status(case_code) {
    const r = this._rows.get(case_code);
    return r ? { case_code: r.case_code, status: r.status } : null;
  }

  // Raw row access (for the data-exfiltration SIM): returns whatever is stored.
  _rawRow(case_code) {
    return this._rows.get(case_code) || null;
  }

  count() {
    return this._rows.size;
  }

  _coarse(ms) {
    // Coarsen the timestamp (anti-correlation): hour granularity.
    return new Date(Math.floor(ms / 3_600_000) * 3_600_000).toISOString();
  }
}

module.exports = { ReportStore, IdentityMinimizationError, IDENTITY_DENYLIST, ALLOWED_COLUMNS };
