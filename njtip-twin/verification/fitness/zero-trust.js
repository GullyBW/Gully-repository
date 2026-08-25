'use strict';
// FITNESS: Zero Trust (authenticate every request; fail-closed on control outage).
// Refs: DDR-09, design/04 · Threats: S-3, E-1 · Risk: RK-06
module.exports = {
  id: 'FIT-ZERO-TRUST',
  title: 'Zero Trust: no implicit trust; fail-closed',
  severity: 'critical',
  refs: { ddr: ['DDR-09'], decision: ['D-01'], threats: ['S-3', 'E-1'], risks: ['RK-06'] },
  check(twin) {
    const violations = [];
    // (1) Unauthenticated request is denied regardless of anything else.
    const un = twin.iam.decide({ principal: 'x', action: 'get-status', zone: twin.zones.INDEPENDENT, matter: '*', authenticated: false });
    if (un.allow) violations.push('unauthenticated request was allowed');
    // (2) Fail-closed: with the policy engine unavailable, requests are denied.
    twin.policy.setAvailable(false);
    const outage = twin.policy.evaluate({ action: 'submit-report' });
    twin.policy.setAvailable(true); // restore
    if (outage.effect !== 'deny') violations.push('policy engine failed OPEN during outage');
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs,
      pass: violations.length === 0, violations };
  },
};
