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

  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, id) { this._audit.push({ at: this._clock(), event, migration: id }); }
  _must(id) { const m = this._migrations.get(id); if (!m) throw new Error('unknown migration: ' + id); return m; }
}

module.exports = { QuantumMigrationRegistry, ROADMAP_PHASES };
