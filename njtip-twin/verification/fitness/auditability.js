'use strict';
// FITNESS: Auditability (append-only, hash-chained, externally anchored, tamper-evident).
// Refs: DDR-13 · Threats: T-2, R-2, R-3 · Risk: RK-06
module.exports = {
  id: 'FIT-AUDITABILITY',
  title: 'Tamper-evident, anchored, append-only audit',
  severity: 'critical',
  refs: { ddr: ['DDR-13'], decision: ['D-01'], threats: ['T-2', 'R-2', 'R-3'], risks: ['RK-06'] },
  check(twin) {
    const violations = [];
    const cap = twin.audit.capabilities();
    if (!cap.appendOnly) violations.push('audit log exposes update/delete (not append-only)');
    if (!cap.hashChained) violations.push('audit log is not hash-chained');
    if (!cap.anchored) violations.push('audit log head is not externally anchored');
    // Append a couple of records and confirm the chain verifies.
    twin.audit.append({ actor: 'sys', action: 'probe-1', purpose: 'fitness', zone: 'independent' });
    twin.audit.append({ actor: 'sys', action: 'probe-2', purpose: 'fitness', zone: 'independent' });
    const v = twin.audit.verifyIntegrity();
    if (!v.ok) violations.push(`audit chain failed integrity check at ${v.brokenAt}`);
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs,
      pass: violations.length === 0, violations };
  },
};
