'use strict';
// FITNESS: Governance compliance (threshold custody; signed, CoI-aware routing).
// Refs: DDR-10, DDR-13, D-01 · Threats: E-1, I-1, T-4 · Risk: RK-01, RK-06, RK-03
module.exports = {
  id: 'FIT-GOVERNANCE',
  title: 'Operator-in-threat-model: threshold custody + CoI routing',
  severity: 'critical',
  refs: { ddr: ['DDR-10', 'DDR-13'], decision: ['D-01'], threats: ['E-1', 'I-1', 'T-4'], risks: ['RK-01', 'RK-03', 'RK-06'] },
  check(twin) {
    const violations = [];
    // (1) Threshold must require at least 2 custodians (no single-party override).
    if (twin.threshold.M < 2) violations.push('threshold M < 2 (single party could act)');
    // (2) A single approval must NOT authorize a de-anon-capable operation.
    let singleBlocked = false;
    try { twin.threshold.authorize('de-anonymize', ['c1']); } catch (e) { singleBlocked = e.code === 'THRESHOLD_NOT_MET'; }
    if (!singleBlocked) violations.push('single-custodian de-anonymize was AUTHORIZED');
    // (3) M distinct custodians DO authorize.
    let mOk = false;
    try { mOk = twin.threshold.authorize('de-anonymize', ['c1', 'c2', 'c3']).ok; } catch (_) { mOk = false; }
    if (!mOk) violations.push('valid M-of-N authorization failed');
    // (4) Recipient directory must be signed.
    if (!twin.recipients.signed) violations.push('recipient directory is not signed (T-4)');
    // (5) CoI routing: a police-subject report must not route to police.
    const r = twin.recipients.route('police');
    if (!r.recipientId || r.recipientId === 'police') violations.push('CoI routing returned a conflicted recipient');
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs,
      pass: violations.length === 0, violations };
  },
};
