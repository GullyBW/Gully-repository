'use strict';
// FITNESS: Secure data flows (PII-free cross-zone events; only permitted directions).
// Refs: DDR-07 · Threats: I-6, DD-1, L-2 · Risk: RK-09
module.exports = {
  id: 'FIT-SECURE-DATA-FLOWS',
  title: 'Secure cross-zone data flows (PII-free, directional)',
  severity: 'critical',
  refs: { ddr: ['DDR-07'], decision: ['D-06'], threats: ['I-6', 'DD-1', 'L-2'], risks: ['RK-09'] },
  check(twin) {
    const violations = [];
    // (1) A cross-zone event carrying PII must be rejected.
    let piiBlocked = false;
    try {
      twin.bus.publish({ type: 'ReportRouted', sourceZone: twin.zones.INDEPENDENT, targetZone: twin.zones.EXECUTIVE, payload: { case_code: 'X', email: 'a@b.c' } });
    } catch (e) { piiBlocked = /PII field/i.test(e.message); }
    if (!piiBlocked) violations.push('cross-zone event with PII was NOT blocked');
    // (2) A disallowed cross-zone direction must be rejected (judiciary->independent).
    let dirBlocked = false;
    try {
      twin.bus.publish({ type: 'X', sourceZone: twin.zones.JUDICIARY, targetZone: twin.zones.INDEPENDENT, payload: { a: 1 } });
    } catch (e) { dirBlocked = /not permitted/i.test(e.message); }
    if (!dirBlocked) violations.push('disallowed cross-zone direction was permitted');
    // (3) A permitted, PII-free flow succeeds (executive->judiciary handoff).
    let okFlow = false;
    try {
      const evt = twin.bus.publish({ type: 'CaseHandoff', sourceZone: twin.zones.EXECUTIVE, targetZone: twin.zones.JUDICIARY, payload: { case_ref: 'C1' } });
      okFlow = !!evt;
    } catch (_) { okFlow = false; }
    if (!okFlow) violations.push('a permitted PII-free cross-zone flow was blocked');
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs,
      pass: violations.length === 0, violations };
  },
};
