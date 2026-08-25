'use strict';
// Cryptographic Agility Platform (Phase 47). Prepares the platform for decades-long crypto
// evolution: an algorithm-abstraction port, a crypto POLICY registry, key lifecycle
// governance, POST-QUANTUM readiness interfaces, signature/certificate MIGRATION strategies,
// and compatibility validation. Deterministic.
//
// 🔒 The reference implementations remain SYNTHETIC and production cryptographic material
// stays HUMAN-MANAGED (HSM/KMS). This platform governs WHICH algorithms are used and HOW
// migrations happen — never the key material itself, which it never generates.
const ALGORITHMS = {
  signature: [
    { id: 'ed25519', status: 'active', pq: false },
    { id: 'ecdsa-p256', status: 'active', pq: false },
    { id: 'rsa-2048', status: 'deprecated', pq: false },
    { id: 'ml-dsa-65', status: 'candidate', pq: true },   // post-quantum (Dilithium) — interface only
  ],
  kem: [
    { id: 'x25519', status: 'active', pq: false },
    { id: 'ml-kem-768', status: 'candidate', pq: true },  // post-quantum (Kyber) — interface only
  ],
};

class CryptoPolicyRegistry {
  constructor() { this._algos = JSON.parse(JSON.stringify(ALGORITHMS)); }
  // Which algorithms are permitted for a purpose right now (active only, by default).
  permitted(purpose, { includeCandidate = false } = {}) { return (this._algos[purpose] || []).filter((a) => a.status === 'active' || (includeCandidate && a.status === 'candidate')).map((a) => a.id); }
  isPermitted(purpose, algoId) { return this.permitted(purpose).includes(algoId); }
  deprecate(purpose, algoId) { const a = (this._algos[purpose] || []).find((x) => x.id === algoId); if (a) a.status = 'deprecated'; return !!a; }
  promote(purpose, algoId) { const a = (this._algos[purpose] || []).find((x) => x.id === algoId); if (a) a.status = 'active'; return !!a; }
  // Post-quantum readiness: are PQ candidate algorithms available for every purpose?
  pqReadiness() { const out = {}; for (const purpose of Object.keys(this._algos)) out[purpose] = { pqCandidates: this._algos[purpose].filter((a) => a.pq).map((a) => a.id), ready: this._algos[purpose].some((a) => a.pq) }; return { byPurpose: out, note: 'PQ algorithms are interface-declared; real PQ crypto is human-built/HSM-managed.' }; }
  catalog(purpose) { return this._algos[purpose] || []; }
}

// Algorithm-abstraction port: selects an algorithm by policy; during MIGRATION it accepts an
// old + a new algorithm so artifacts signed under either verify (overlap window).
class CryptoProvider {
  constructor(registry, { purpose = 'signature' } = {}) { this._reg = registry; this._purpose = purpose; this._primary = registry.permitted(purpose)[0]; this._legacy = []; }
  primary() { return this._primary; }
  // Begin a migration: the new algorithm becomes primary; the old stays valid for verification.
  migrate(newAlgo) { if (!this._reg.isPermitted(this._purpose, newAlgo)) { this._reg.promote(this._purpose, newAlgo); } this._legacy.push(this._primary); this._primary = newAlgo; return { primary: this._primary, legacy: [...this._legacy] }; }
  // Compatibility validation: an artifact's algorithm is acceptable if it is primary or legacy
  // (during the migration overlap). Deterministic.
  accepts(algo) { return algo === this._primary || this._legacy.includes(algo); }
}

// Key lifecycle governance: key states + a migration plan (over key REFERENCES, never material).
class KeyLifecycleGovernance {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._keys = new Map(); }
  register(keyRef, { algo }) { this._keys.set(keyRef, { keyRef, algo, state: 'active', since: this._clock() }); return keyRef; }
  beginRotation(keyRef, newRef, newAlgo) { const k = this._must(keyRef); k.state = 'rotating'; this._keys.set(newRef, { keyRef: newRef, algo: newAlgo, state: 'active', supersedes: keyRef, since: this._clock() }); return { rotatingOut: keyRef, rotatingIn: newRef }; }
  retire(keyRef) { const k = this._must(keyRef); if (k.state !== 'rotating') throw new Error('a key must be rotating before retirement'); k.state = 'retired'; return { keyRef, state: 'retired' }; }
  inventory() { return [...this._keys.values()].map((k) => ({ keyRef: k.keyRef, algo: k.algo, state: k.state })); }
  _must(keyRef) { const k = this._keys.get(keyRef); if (!k) throw new Error('unknown key: ' + keyRef); return k; }
}

function makeCryptoAgility() { const registry = new CryptoPolicyRegistry(); return { registry, provider: (purpose) => new CryptoProvider(registry, { purpose }), keys: new KeyLifecycleGovernance() }; }

module.exports = { CryptoPolicyRegistry, CryptoProvider, KeyLifecycleGovernance, makeCryptoAgility, ALGORITHMS };
