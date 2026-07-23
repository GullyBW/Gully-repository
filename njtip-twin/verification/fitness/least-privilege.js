'use strict';
// FITNESS: Least privilege + separation of duties + zero standing privilege.
// Refs: DDR-09 · Threats: E-1, E-3, S-3 · Risk: RK-06
module.exports = {
  id: 'FIT-LEAST-PRIVILEGE',
  title: 'Least privilege, zero standing privilege, separation of duties',
  severity: 'critical',
  refs: { ddr: ['DDR-09'], decision: ['D-01'], threats: ['E-1', 'E-3', 'S-3'], risks: ['RK-06'] },
  check(twin) {
    const violations = [];
    // (1) No standing sensitive grants.
    const standing = twin.iam.standingSensitiveGrants();
    if (standing.length) violations.push(`${standing.length} standing sensitive grant(s) present`);
    // (2) No separation-of-duties violations.
    for (const v of twin.iam.sodViolations()) violations.push(`SoD violation: ${v.principal} holds ${v.pair.join('+')}`);
    // (3) Dynamic: a sensitive action without a valid grant is denied.
    const d = twin.iam.decide({ principal: 'nobody', action: 'read-evidence', zone: twin.zones.EXECUTIVE, matter: 'M1' });
    if (d.allow) violations.push('sensitive action allowed WITHOUT a grant (default-allow?)');
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs,
      pass: violations.length === 0, violations };
  },
};
