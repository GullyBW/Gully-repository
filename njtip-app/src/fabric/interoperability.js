'use strict';
// National Interoperability Framework (Phase 48). Extends the Data Fabric with government
// interoperability PROFILES, canonical information models, shared VOCABULARIES, cross-agency
// SEMANTIC MAPPINGS, exchange validation + certification, and conformance testing. Additive
// and backward-compatible: new profile versions may only ADD (existing integrations never
// break). Deterministic. All exchanged references are non-identifying.
const { backwardCompatible } = require('./registry');

class InteroperabilityProfile {
  constructor() { this._profiles = new Map(); }
  // Register a profile version; a new version must be backward compatible with the previous.
  register(name, { canonical, requiredFields = [], vocabulary = {} } = {}) {
    const versions = this._profiles.get(name) || [];
    const prev = versions[versions.length - 1];
    const schema = { fields: canonical || {}, required: requiredFields };
    if (prev && !backwardCompatible({ fields: prev.canonical, required: prev.requiredFields }, schema)) throw new Error(`interoperability profile '${name}' change is not backward compatible`);
    const version = versions.length + 1;
    versions.push({ name, version, canonical: canonical || {}, requiredFields: [...requiredFields], vocabulary });
    this._profiles.set(name, versions);
    return { name, version };
  }
  latest(name) { const v = this._profiles.get(name); return v ? v[v.length - 1] : null; }

  // Validate a data-exchange payload against a profile (required fields present + typed).
  validateExchange(name, payload) {
    const p = this.latest(name); if (!p) return { ok: false, reason: 'unknown profile' };
    const missing = p.requiredFields.filter((f) => !(f in (payload || {})));
    const wrongType = Object.entries(p.canonical).filter(([f, t]) => f in (payload || {}) && typeof payload[f] !== t).map(([f]) => f);
    return { ok: missing.length === 0 && wrongType.length === 0, missing, wrongType };
  }
  // Conformance test suite → pass/fail per sample; certification requires 100% conformance.
  conformanceTest(name, samples = []) {
    const results = samples.map((s) => ({ sample: s.label || '', ok: this.validateExchange(name, s.payload).ok }));
    return { total: results.length, passed: results.filter((r) => r.ok).length, results, conformant: results.every((r) => r.ok) };
  }
  certifyExchange(agency, name, samples = []) {
    const c = this.conformanceTest(name, samples);
    return { agency, profile: name, certified: c.conformant, conformance: `${c.passed}/${c.total}`, note: 'Certification attests conformance; production onboarding remains a human governance decision.' };
  }
}

// Cross-agency semantic mapping: map an agency's field names → canonical field names.
class SemanticMapping {
  constructor() { this._maps = new Map(); }
  define(agency, mapping) { this._maps.set(agency, mapping); return agency; }
  // Translate an agency payload into the canonical vocabulary (non-identifying fields only).
  toCanonical(agency, payload) {
    const map = this._maps.get(agency); if (!map) return payload;
    const out = {};
    for (const [from, to] of Object.entries(map)) if (from in payload) out[to] = payload[from];
    return out;
  }
}

// Shared vocabulary: term → canonical concept (governs a common language across agencies).
class SharedVocabulary {
  constructor(terms = {}) { this._terms = new Map(Object.entries(terms)); }
  add(term, concept) { this._terms.set(term, concept); return this; }
  resolve(term) { return this._terms.get(term) || null; }
  all() { return Object.fromEntries(this._terms); }
}

module.exports = { InteroperabilityProfile, SemanticMapping, SharedVocabulary };
