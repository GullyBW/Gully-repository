'use strict';
// FITNESS: Trusted time source (skew detection) + certificate validity.
// Refs: DDR-06 · Threats: T-5 · Risk: RK-13
module.exports = {
  id: 'FIT-TIME-INTEGRITY',
  title: 'Trusted time source with skew detection; cert validity enforced',
  severity: 'high',
  refs: { ddr: ['DDR-06'], decision: ['D-03'], threats: ['T-5'], risks: ['RK-13'] },
  check(twin) {
    const violations = [];
    const cert = twin.time.certValid(twin.cert);
    if (!cert.valid) violations.push('synthetic certificate is not valid at current time');
    // In-tolerance sync passes.
    const ref = twin.time.now();
    if (!twin.time.checkSync(ref).ok) violations.push('in-tolerance time sync flagged as skewed');
    // Injected large skew must be detected.
    twin.time._injectSkew(120_000);
    const skewed = twin.time.checkSync(ref).ok;
    twin.time._reset();
    if (skewed) violations.push('large clock skew was NOT detected');
    return { id: this.id, title: this.title, severity: this.severity, refs: this.refs, pass: violations.length === 0, violations };
  },
};
