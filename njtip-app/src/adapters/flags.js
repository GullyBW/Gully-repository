'use strict';
// Feature-flag PORT for CONTROLLED ROLLOUT (pilot cohorts, canary %, kill-switches).
// Deterministic: a flag's rollout is decided by a stable hash of (flag, subject) so the
// same subject always gets the same decision (sticky) without storing any identity — the
// subject key is an OPAQUE, non-identifying token (e.g. a case code or a cohort id), never
// a person. Reference is in-memory; production drivers (LaunchDarkly/Unleash/config) keep
// the same isEnabled() contract.
const crypto = require('node:crypto');

class FeatureFlags {
  constructor(defs = {}) { this._defs = new Map(Object.entries(defs)); }
  // def: { enabled?: bool, rolloutPct?: 0..100, cohorts?: [ids] }
  set(name, def) { this._defs.set(name, def); return this; }

  // Deterministic bucket in [0,100) from an opaque subject key (no identity).
  _bucket(name, subject) { const h = crypto.createHash('sha256').update(`${name}:${subject}`).digest(); return h.readUInt16BE(0) % 100; }

  isEnabled(name, { subject = '', cohort } = {}) {
    const def = this._defs.get(name); if (!def) return false;
    if (def.enabled === false) return false;              // kill-switch
    if (def.enabled === true && def.rolloutPct == null && !def.cohorts) return true;
    if (def.cohorts && cohort && def.cohorts.includes(cohort)) return true;
    if (def.rolloutPct != null) return this._bucket(name, subject) < def.rolloutPct; // sticky canary %
    return !!def.enabled;
  }
  all() { return Object.fromEntries(this._defs); }
}

function makeFeatureFlags(cfg = {}) {
  // Pilot defaults: enterprise features off by default; enabled per pilot cohort/%.
  return new FeatureFlags(cfg.flags || {
    'enterprise-search': { enabled: true },
    'analytics-export': { enabled: true },
    'pilot-cohort-rollout': { rolloutPct: 0, cohorts: ['pilot-internal'] },
  });
}

module.exports = { FeatureFlags, makeFeatureFlags };
