'use strict';
// Governance Review Portal — an append-only, hash-chained ledger of HUMAN decisions.
// It RECORDS human judgment (readiness decisions, waivers, remediation, rationale,
// maturity attestations). It NEVER computes or automates governance authority: a
// decision exists only because an authorized human recorded it, with rationale.
const fs = require('node:fs');
const path = require('node:path');
const { chain } = require('../util/hash');

const DECISION_TYPES = ['readiness', 'waiver', 'remediation-request', 'maturity-attestation', 'note'];

class GovernanceLedger {
  constructor(file) {
    this.file = file;
    this._entries = [];
    this._head = null;
    this._load();
  }

  _load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this._entries = d.entries || [];
      this._head = this._entries.length ? this._entries[this._entries.length - 1].hash : null;
    } catch (_) { this._entries = []; this._head = null; }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ entries: this._entries }, null, 2));
  }

  // Record a HUMAN decision. Requires an accountable human + rationale — automation
  // cannot satisfy these fields on its own.
  record({ reviewer, role, decisionType, subject, verdict, rationale, seq }) {
    if (!reviewer) throw new Error('a named accountable human reviewer is required');
    if (!rationale) throw new Error('rationale is required (decisions must be explained)');
    if (!DECISION_TYPES.includes(decisionType)) throw new Error(`unknown decisionType: ${decisionType}`);
    const record = {
      seq: this._entries.length, reviewer, role: role || 'reviewer', decisionType, subject: subject || '',
      verdict: verdict || '', rationale, at: seq != null ? seq : this._entries.length,
      note: 'HUMAN DECISION — recorded, not automated',
    };
    const hash = chain(this._head, record);
    const entry = { record, prevHash: this._head, hash };
    this._entries.push(entry);
    this._head = hash;
    this._save();
    return entry;
  }

  verify() {
    let prev = null;
    for (const e of this._entries) {
      if (e.prevHash !== prev || e.hash !== chain(prev, e.record)) return { ok: false, brokenAt: e.record.seq };
      prev = e.hash;
    }
    return { ok: true, length: this._entries.length };
  }

  history() { return this._entries.map((e) => ({ ...e.record })); }

  // Extract human maturity attestations (levels 7–10) for the maturity model.
  maturityAttestations() {
    const out = {};
    for (const e of this._entries) {
      if (e.record.decisionType === 'maturity-attestation' && e.record.verdict) {
        const lvl = Number(e.record.subject);
        if (lvl >= 7 && lvl <= 10 && e.record.verdict === 'attest') out[lvl] = { attestedBy: e.record.reviewer, rationale: e.record.rationale };
      }
    }
    return out;
  }
}

module.exports = { GovernanceLedger, DECISION_TYPES };
