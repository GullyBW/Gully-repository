'use strict';
// FITNESS: Policy enforcement (default-deny, fail-closed).
// Refs: phase2/02, DDR-09 · Threats: E-1 · Risk: RK-06
module.exports = {
  id: 'FIT-POLICY-ENFORCEMENT',
  title: 'Policy engine default-deny and fail-closed',
  severity: 'critical',
  refs: { ddr: ['DDR-09'], decision: ['D-06'], threats: ['E-1'], risks: ['RK-06'] },
  check(twin) {
    const violations = [];
    const introspect = twin.policy.introspect();
    if (introspect.defaultEffect !== 'deny') violations.push('policy default is not deny');
    // Unknown action must be denied.
    const unknown = twin.policy.evaluate({ action: 'exfiltrate-everything' });
    if (unknown.effect !== 'deny') violations.push('unknown action was not denied');
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs,
      pass: violations.length === 0, violations };
  },
};
