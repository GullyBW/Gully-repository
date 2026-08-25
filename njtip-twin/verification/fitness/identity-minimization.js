'use strict';
// FITNESS: Identity minimization (no reporter identity is ever collected/stored).
// Refs: DDR-05, D-02 · Threats: ID-1, I-1 · Risk: RK-01
const { IDENTITY_DENYLIST } = require('../../src/model/report-store');
module.exports = {
  id: 'FIT-IDENTITY-MINIMIZATION',
  title: 'Identity minimization (no C0 identity fields)',
  severity: 'critical',
  refs: { ddr: ['DDR-05'], decision: ['D-02'], threats: ['ID-1', 'I-1'], risks: ['RK-01'] },
  check(twin) {
    const violations = [];
    // (1) Static: report schema contains no identity column.
    const cols = twin.stores.report.schema().columns.map((c) => c.toLowerCase());
    for (const c of cols) if (IDENTITY_DENYLIST.includes(c)) violations.push(`report schema exposes identity column "${c}"`);
    // (2) Dynamic: attempting to store identity is rejected at write time.
    let rejected = false;
    try {
      twin.stores.report.submit({ case_code: 'PROBE', category: 'police', content: 'x', email: 'a@b.c' });
    } catch (e) {
      rejected = /identity field rejected/i.test(e.message);
    }
    if (!rejected) violations.push('report store ACCEPTED an identity field (must reject)');
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs,
      pass: violations.length === 0, violations };
  },
};
