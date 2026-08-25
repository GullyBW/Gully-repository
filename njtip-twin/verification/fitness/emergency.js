'use strict';
// FITNESS: Emergency/break-glass access is dual-controlled, reason-coded, time-boxed.
// Refs: DDR-09 · Threats: E-1, E-3 · Risk: RK-06, RK-24
module.exports = {
  id: 'FIT-EMERGENCY',
  title: 'Break-glass requires dual control + reason + expiry',
  severity: 'critical',
  refs: { ddr: ['DDR-09'], decision: ['D-01'], threats: ['E-1', 'E-3'], risks: ['RK-06', 'RK-24'] },
  check(twin) {
    const violations = [];
    // Single-approver break-glass must be rejected.
    let singleBlocked = false;
    try { twin.emergency.request({ operation: 'restore-service', principal: 'op1', approvals: ['a1'], reason: 'outage' }); }
    catch (e) { singleBlocked = e.code === 'DUAL_CONTROL_REQUIRED'; }
    if (!singleBlocked) violations.push('single-approver break-glass was granted');
    // Missing reason must be rejected.
    let reasonRequired = false;
    try { twin.emergency.request({ operation: 'x', principal: 'op1', approvals: ['a1', 'a2'] }); }
    catch (e) { reasonRequired = /reason/i.test(e.message); }
    if (!reasonRequired) violations.push('break-glass granted without a reason code');
    // Valid dual-controlled grant works and is active + audited.
    const before = twin.audit.entries().length;
    const g = twin.emergency.request({ operation: 'restore-service', principal: 'op1', approvals: ['a1', 'a2'], reason: 'outage' });
    if (!twin.emergency.isActive('restore-service', 'op1')) violations.push('valid break-glass not active');
    if (twin.audit.entries().length <= before) violations.push('break-glass not audited');
    if (!g.expires) violations.push('break-glass grant not time-boxed');
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs, pass: violations.length === 0, violations };
  },
};
