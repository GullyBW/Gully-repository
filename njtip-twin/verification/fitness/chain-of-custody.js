'use strict';
// FITNESS: Digital chain of custody (integrity re-verified on access; tamper detected).
// Refs: DDR-06, D-10 · Threats: T-1, T-5 · Risk: RK-08
module.exports = {
  id: 'FIT-CHAIN-OF-CUSTODY',
  title: 'Evidence chain of custody is tamper-evident',
  severity: 'critical',
  refs: { ddr: ['DDR-06'], decision: ['D-10'], threats: ['T-1', 'T-5'], risks: ['RK-08'] },
  check(twin) {
    const violations = [];
    const ev = twin.stores.evidenceExec;
    ev.ingest({ id: 'COC1', actor: 'inv1', role: 'investigate', content: 'coc-synthetic', matter: 'M1' });
    const acc = ev.access('COC1', 'inv1', 'investigate', 'read');
    if (!acc.ok) violations.push('access did not succeed / integrity re-verify failed');
    if (!ev.verifyObject('COC1', 'coc-synthetic').ok) violations.push('untampered object failed verification');
    ev._forceTamper('COC1');
    if (ev.verifyObject('COC1', 'coc-synthetic').ok) violations.push('tampered object was NOT detected');
    if (!ev.verifyCustodyChain().ok) violations.push('custody chain failed integrity');
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs, pass: violations.length === 0, violations };
  },
};
