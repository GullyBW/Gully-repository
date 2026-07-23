'use strict';
// FITNESS: Traceability coverage — every requirement has >=1 verifier and every
// referenced verifier ID actually exists (fitness / simulation / formal registry).
// Refs: D-11 · This makes "every requirement is continuously verifiable" a gated invariant.
const requirements = require('../../src/traceability/requirements');
module.exports = {
  id: 'FIT-TRACEABILITY-COVERAGE',
  title: 'Every requirement is continuously verifiable (100% coverage)',
  severity: 'critical',
  refs: { ddr: [], decision: ['D-11'], threats: [], risks: [] },
  check() {
    const violations = [];
    // Lazy requires (avoid load-time cycles) to enumerate known verifier IDs.
    const fitnessIds = new Set(require('./index').map((f) => f.id));
    const simIds = new Set(require('../../adversarial').list().map((s) => s.id));
    const formalIds = new Set(require('../../formal').list().map((f) => f.id));
    for (const req of requirements) {
      const v = req.verifiers || {};
      const total = (v.fitness || []).length + (v.sims || []).length + (v.formal || []).length;
      if (total === 0) violations.push(`${req.id} has no verifiers`);
      for (const id of v.fitness || []) if (!fitnessIds.has(id)) violations.push(`${req.id} references unknown fitness "${id}"`);
      for (const id of v.sims || []) if (!simIds.has(id)) violations.push(`${req.id} references unknown simulation "${id}"`);
      for (const id of v.formal || []) if (!formalIds.has(id)) violations.push(`${req.id} references unknown formal check "${id}"`);
    }
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs, pass: violations.length === 0, violations };
  },
};
