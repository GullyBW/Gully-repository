'use strict';
// FITNESS: Data-zone isolation (Constitutional Architecture).
// Refs: DDR-01, DDR-04, D-06 · Threats: I-6, E-3 · Risk: RK-09
module.exports = {
  id: 'FIT-ZONE-ISOLATION',
  title: 'Data-zone isolation (no cross-zone DB paths)',
  severity: 'critical',
  refs: { ddr: ['DDR-01', 'DDR-04'], decision: ['D-06'], threats: ['I-6', 'E-3'], risks: ['RK-09'] },
  check(twin) {
    const violations = [];
    // (1) Static: no service connects to a DB outside its own zone.
    for (const svc of twin.services) {
      for (const z of svc.dbZones) {
        if (z !== svc.zone) violations.push(`service "${svc.name}" (${svc.zone}) has DB link to ${z}`);
      }
    }
    // (2) Dynamic: a cross-zone raw DB read is refused at runtime.
    const probe = twin.attemptDbRead('investigation', twin.zones.JUDICIARY);
    if (probe.allowed) violations.push('cross-zone DB read was ALLOWED (should be forbidden)');
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs,
      pass: violations.length === 0, violations };
  },
};
