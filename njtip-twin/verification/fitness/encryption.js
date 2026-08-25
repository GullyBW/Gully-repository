'use strict';
// FITNESS: Encryption at rest (content is ciphertext; keys not co-located as plaintext).
// Refs: DDR-10, DDR-05 · Threats: I-4, I-1 · Risk: RK-01
const { isCiphertext } = require('../../src/platform/crypto');
module.exports = {
  id: 'FIT-ENCRYPTION',
  title: 'Encryption at rest (no plaintext content stored)',
  severity: 'critical',
  refs: { ddr: ['DDR-10', 'DDR-05'], decision: ['D-02'], threats: ['I-4', 'I-1'], risks: ['RK-01'] },
  check(twin) {
    const violations = [];
    // Store a synthetic report + evidence, then inspect what is at rest.
    twin.stores.report.submit({ case_code: 'ENC-PROBE', category: 'courts', content: 'sensitive synthetic content' });
    const row = twin.stores.report._rawRow('ENC-PROBE');
    if (!isCiphertext(row.content_cipher)) violations.push('report content is not ciphertext at rest');
    if (typeof row.content_cipher === 'string') violations.push('report content stored as plaintext string');

    twin.stores.evidenceExec.ingest({ id: 'ENC-EV', actor: 'inv1', role: 'investigate', content: 'synthetic evidence', matter: 'M1' });
    const obj = twin.stores.evidenceExec._rawObject('ENC-EV');
    if (!isCiphertext(obj.cipher)) violations.push('evidence content is not ciphertext at rest');
    // keyRef must be a reference, not embedded raw key material.
    if (row.content_key_ref && !String(row.content_key_ref).startsWith('synthetic-kms://')) {
      violations.push('key reference does not look like an external KMS ref');
    }
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs,
      pass: violations.length === 0, violations };
  },
};
