'use strict';
// Quantum-Resilient Transition Platform (Phase 57). Extends cryptographic agility with a
// quantum-migration registry, algorithm-migration PLANNING, compatibility analysis, migration
// SIMULATION, HYBRID cryptography interfaces (classical + post-quantum), transition roadmaps,
// migration readiness assessment, and algorithm lifecycle governance. Deterministic.
//
// 🔒 Reference implementations remain SYNTHETIC and production key material stays
// HUMAN-MANAGED. Post-quantum algorithms are INTERFACE-DECLARED only — no cryptography is
// generated here. Readiness is advisory and human-gated.
const { CryptoPolicyRegistry } = require('./crypto-agility');

// The governed migration roadmap: assess → deploy hybrid → migrate → retire classical.
const ROADMAP_PHASES = ['assess', 'hybrid-deploy', 'migrate', 'retire-classical'];

class QuantumMigrationRegistry {
  constructor({ clock = () => Date.now(), cryptoRegistry } = {}) { this._clock = clock; this._reg = cryptoRegistry || new CryptoPolicyRegistry(); this._migrations = new Map(); this._seq = 0; this._audit = []; }

  // Compatibility analysis: the target must be a known POST-QUANTUM algorithm for the purpose.
  compatibility(purpose, fromAlgo, toAlgo) {
    const catalog = this._reg.catalog(purpose);
    const from = catalog.find((a) => a.id === fromAlgo);
    const to = catalog.find((a) => a.id === toAlgo);
    const issues = [];
    if (!from) issues.push(`unknown source algorithm '${fromAlgo}'`);
    if (!to) issues.push(`unknown target algorithm '${toAlgo}'`);
    if (to && !to.pq) issues.push(`target '${toAlgo}' is not post-quantum`);
    return { compatible: issues.length === 0, issues };
  }

  // Plan a migration (starts in 'assess'); refuses an incompatible target (fail-closed).
  plan(id, { purpose = 'signature', fromAlgo, toAlgo } = {}) {
    const compat = this.compatibility(purpose, fromAlgo, toAlgo);
    if (!compat.compatible) { const e = new Error('quantum migration plan refused: ' + compat.issues.join('; ')); e.compat = compat; throw e; }
    this._migrations.set(id, { id, purpose, fromAlgo, toAlgo, phase: 'assess', hybridTested: false, startedAt: this._clock() });
    this._log('planned', id);
    return this.describe(id);
  }
  describe(id) { const m = this._must(id); return { ...m }; }
  roadmap() { return [...this._migrations.values()].map((m) => ({ id: m.id, purpose: m.purpose, from: m.fromAlgo, to: m.toAlgo, phase: m.phase })); }

  // Advance to the next roadmap phase. Moving PAST 'hybrid-deploy' requires hybrid to be
  // tested (compatibility during overlap) — fail-closed.
  advance(id) {
    const m = this._must(id); const i = ROADMAP_PHASES.indexOf(m.phase);
    if (i === ROADMAP_PHASES.length - 1) throw new Error('migration already at the final phase');
    const next = ROADMAP_PHASES[i + 1];
    if (m.phase === 'hybrid-deploy' && next === 'migrate' && !m.hybridTested) throw new Error('cannot migrate before hybrid verification is tested');
    m.phase = next; this._log('advanced:' + next, id);
    return this.describe(id);
  }
  // Hybrid cryptography interface (reference): an artifact is signed under BOTH the classical
  // and PQ algorithms; verification requires BOTH. Synthetic — declares intent, not crypto.
  markHybridTested(id) { const m = this._must(id); m.hybridTested = true; return { id, hybridTested: true, note: 'Hybrid (classical + PQ) verification interface exercised (synthetic).' }; }

  // Migration simulation: deterministic projection of the remaining phases + a risk note.
  simulate(id) { const m = this._must(id); const i = ROADMAP_PHASES.indexOf(m.phase); return { id, remainingPhases: ROADMAP_PHASES.slice(i + 1), risk: m.hybridTested ? 'low' : 'medium', note: 'Simulated migration path; advisory. 🔒 real crypto is human-built.' }; }

  // Migration readiness (ADVISORY, human-gated): PQ target available + hybrid tested.
  readiness(id) { const m = this._must(id); const pq = this._reg.pqReadiness().byPurpose[m.purpose]; return { id, pqCandidateAvailable: !!(pq && pq.ready), hybridTested: m.hybridTested, ready: !!(pq && pq.ready) && m.hybridTested, humanGate: true, note: 'Migration readiness is advisory; cutover is a recorded human decision.' }; }

  // --- Quantum migration roadmap (Stabilization Part 11) --------------------------------

  // The assumptions the roadmap rests on. Written down because an unstated assumption is the
  // usual reason a cryptographic migration plan fails years later.
  assumptions() {
    return [
      { id: 'harvest-now-decrypt-later', assumption: 'Long-lived confidential material may already be captured today and decrypted once a cryptanalytically relevant quantum computer exists.', consequence: 'Confidentiality of archived evidence is migrated before authentication; key-establishment moves first.' },
      { id: 'standards-may-change', assumption: 'Post-quantum standards and parameter sets will change after first adoption.', consequence: 'No algorithm may be named outside the crypto policy registry; selection stays data, never code.' },
      { id: 'hybrid-first', assumption: 'A post-quantum algorithm alone is not yet trusted for sole reliance.', consequence: 'Hybrid (classical + PQ) is a mandatory phase; migrate past it only after hybrid verification is tested.' },
      { id: 'human-key-custody', assumption: '🔒 Production key material is generated and custodied by humans under ISRB sign-off.', consequence: 'This registry governs algorithm policy and migration phase only; it never generates or holds key material.' },
      { id: 'long-retention', assumption: 'Evidence and audit records outlive several cryptographic generations.', consequence: 'Verification must accept legacy algorithms for the full retention window; re-signing is planned, not assumed.' },
      { id: 'interoperability', assumption: 'Partner agencies migrate on their own timelines.', consequence: 'Overlap windows are governed per interface, and a partner cannot force a downgrade.' },
    ];
  }

  // What any future implementation must satisfy for a migration to be possible at all.
  compatibilityRequirements() {
    return [
      { requirement: 'Algorithm independence', detail: 'No algorithm identifier appears outside the crypto policy registry; business logic never names one.', verifiedBy: 'algorithmIndependence()' },
      { requirement: 'Dual verification window', detail: 'During overlap, artifacts signed under the legacy OR the new algorithm must verify (CryptoProvider.accepts).', verifiedBy: 'APP-FIT-QUANTUM-OBSERVATORY' },
      { requirement: 'Algorithm recorded with the artifact', detail: 'Every signed or encrypted artifact records which algorithm produced it, so verification never guesses.', verifiedBy: 'custody + provenance chains' },
      { requirement: 'Larger key and signature sizes tolerated', detail: 'Storage, event payload and transport limits must absorb PQ signature growth without a schema change.', verifiedBy: 'contract field surface is size-agnostic' },
      { requirement: 'Policy-driven selection', detail: 'Promotion, deprecation and permitted sets are data changes evaluated at runtime, not redeploys.', verifiedBy: 'CryptoPolicyRegistry' },
      { requirement: 'Fail-closed on unknown algorithm', detail: 'An unrecognised or non-post-quantum target is refused when planning a migration.', verifiedBy: 'plan() throws on an incompatible target' },
    ];
  }

  // The cryptographic abstraction layers — what each may and may not know.
  abstractionLayers() {
    return [
      { layer: 'Policy', module: 'CryptoPolicyRegistry', knows: 'which algorithms are permitted, deprecated or candidate, per purpose', neverKnows: 'key material, ciphertext' },
      { layer: 'Provider (algorithm abstraction)', module: 'CryptoProvider', knows: 'the primary algorithm and the legacy set accepted during overlap', neverKnows: 'why an algorithm was chosen; that is policy' },
      { layer: 'Key lifecycle', module: 'KeyLifecycleGovernance', knows: 'key REFERENCES and their state (active/rotating/retired)', neverKnows: '🔒 key material — it never leaves the HSM' },
      { layer: 'Migration', module: 'QuantumMigrationRegistry', knows: 'phase, compatibility and readiness for each planned migration', neverKnows: 'how to perform cryptography' },
      { layer: 'Domain', module: 'every bounded context', knows: 'encrypt/decrypt/sign/verify through a port', neverKnows: 'any algorithm name at all' },
    ];
  }

  // Algorithm independence: no algorithm identifier may appear outside the crypto modules.
  // Scanned from source so the guarantee is verified, not asserted.
  algorithmIndependence() {
    const fs = require('node:fs'); const path = require('node:path');
    const SRC = path.join(__dirname, '..');
    const ALLOWED = new Set(['adapters/crypto-agility.js', 'adapters/quantum-transition.js']);
    // An algorithm is "named" when a module SELECTS one: a quoted literal whose entire value
    // is an algorithm identifier. Prose in comments and documentation strings is not selection.
    const NAMES = /(['"])(ed25519|ecdsa-p256|rsa-2048|ml-dsa-\d+|ml-kem-\d+|x25519|dilithium|kyber)\1/i;
    const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const walk = (dir, out = []) => {
      for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full, out); else if (full.endsWith('.js')) out.push(full);
      }
      return out;
    };
    const leaks = [];
    for (const f of walk(SRC)) {
      const rel = path.relative(SRC, f).split(path.sep).join('/');
      if (ALLOWED.has(rel)) continue;
      if (NAMES.test(stripComments(fs.readFileSync(f, 'utf8')))) leaks.push(rel);
    }
    return { independent: leaks.length === 0, leaks, allowed: [...ALLOWED], note: 'Algorithm selection is data in the policy registry; no other module may name an algorithm.' };
  }

  // The consolidated transition plan: phases, per-purpose posture, assumptions and readiness.
  transitionPlan() {
    const pq = this._reg.pqReadiness();
    return {
      phases: ROADMAP_PHASES.map((phase, i) => ({
        phase, order: i + 1,
        intent: { assess: 'Inventory every cryptographic use and its retention horizon.', 'hybrid-deploy': 'Deploy classical + PQ together; verify both.', migrate: 'Make PQ primary; keep classical valid for verification.', 'retire-classical': 'Remove classical from the permitted set once no artifact within retention depends on it.' }[phase],
        exitCriterion: { assess: 'Every purpose has a named PQ candidate.', 'hybrid-deploy': 'Hybrid verification tested (markHybridTested).', migrate: 'All new artifacts produced under the PQ primary.', 'retire-classical': 'No artifact inside the retention window verifies only under classical.' }[phase],
      })),
      byPurpose: pq.byPurpose,
      migrations: this.roadmap(),
      assumptions: this.assumptions(),
      compatibilityRequirements: this.compatibilityRequirements(),
      abstractionLayers: this.abstractionLayers(),
      algorithmIndependence: this.algorithmIndependence(),
      humanGate: true, authorizes: false,
      note: '🔒 Interface-declared only. No post-quantum cryptography is implemented here and no key material is generated. Cutover is a recorded human decision.',
    };
  }

  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, id) { this._audit.push({ at: this._clock(), event, migration: id }); }
  _must(id) { const m = this._migrations.get(id); if (!m) throw new Error('unknown migration: ' + id); return m; }
}

module.exports = { QuantumMigrationRegistry, ROADMAP_PHASES };
