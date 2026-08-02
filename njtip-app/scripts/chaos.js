'use strict';
// Executable resilience suite (Phase 10, Part 6): load, stress, spike, soak, recovery and
// every fault-injection experiment, as one deterministic CI gate.
//
// Usage: node scripts/chaos.js [--full]     # --full runs the heavier volumes
const chaos = require('../src/twin2/chaos');
const { hash, signing } = require('../src/twin');

function main() {
  const light = !process.argv.includes('--full');
  const suite = chaos.runSuite({ light });
  const digest = hash.sha256({ performance: suite.performance.map((p) => ({ test: p.test, pass: p.pass })), chaos: suite.chaos.map((c) => ({ experiment: c.experiment, pass: c.pass })) });
  console.log(JSON.stringify({ ...suite, digest, signature: signing.sign(digest) }, null, 2));
  console.log(suite.pass
    ? `\n✅ Resilience: ${suite.tests} checks passed (${light ? 'light' : 'full'} volumes). Evidence ≠ authorization.`
    : `\n❌ Resilience: ${suite.failed.length} check(s) failed: ${suite.failed.join(', ')}`);
  process.exitCode = suite.pass ? 0 : 1;
}
if (require.main === module) main();
module.exports = { main };
