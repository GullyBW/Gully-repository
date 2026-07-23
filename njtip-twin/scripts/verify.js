'use strict';
// Executable architecture verification: run every fitness function against a
// fresh synthetic twin. A failing check is an architecture violation. Exit code
// is non-zero if any CRITICAL invariant fails (this blocks the pipeline).
const { build } = require('../src/platform/orchestrator');
const fitness = require('../verification/fitness');

function runVerification() {
  const twin = build();
  return fitness.map((f) => f.check(twin));
}

function main() {
  const results = runVerification();
  console.log('\n=== Architecture Fitness Functions (synthetic twin) ===');
  for (const r of results) {
    console.log(`${r.pass ? '✅ PASS' : '❌ FAIL'}  ${r.id}  — ${r.title}`);
    if (!r.pass) for (const v of r.violations) console.log(`        ↳ ${v}`);
  }
  const criticalFails = results.filter((r) => !r.pass && r.severity === 'critical');
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed; ${criticalFails.length} critical failure(s).`);
  if (criticalFails.length) process.exitCode = 1;
  return results;
}

if (require.main === module) main();
module.exports = { runVerification };
