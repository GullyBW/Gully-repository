'use strict';
// FITNESS: Backups are ciphertext-only and integrity-checked.
// Refs: DDR-02 · Threats: I-4, D-1 · Risk: RK-13
module.exports = {
  id: 'FIT-BACKUP',
  title: 'Ciphertext-only, integrity-checked backups',
  severity: 'high',
  refs: { ddr: ['DDR-02'], decision: ['D-03'], threats: ['I-4', 'D-1'], risks: ['RK-13'] },
  check(twin) {
    const violations = [];
    twin.stores.evidenceExec.ingest({ id: 'BK1', actor: 'i', role: 'investigate', content: 'bk-synthetic', matter: 'M' });
    const obj = twin.stores.evidenceExec._rawObject('BK1');
    const res = twin.backup.snapshot('snap-1', [obj]);
    if (!res.manifestHash) violations.push('backup produced no manifest hash');
    if (!twin.backup.verify('snap-1').ok) violations.push('backup integrity check failed');
    // Attempting to back up plaintext must be refused.
    let refusedPlaintext = false;
    try { twin.backup.snapshot('bad', [{ id: 'P', contentHash: 'x', cipher: 'PLAINTEXT' }]); }
    catch (_) { refusedPlaintext = true; }
    if (!refusedPlaintext) violations.push('backup accepted a plaintext object');
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs, pass: violations.length === 0, violations };
  },
};
