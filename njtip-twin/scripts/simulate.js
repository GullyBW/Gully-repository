'use strict';
// Adversarial simulation runner: run every scenario against fresh synthetic twins
// and report resilience. Exit non-zero if any scenario is NOT resisted.
const { build } = require('../src/platform/orchestrator');
const { runAll } = require('../adversarial/scenarios');

function runSimulation() {
  return runAll((opts) => build(opts));
}

function main() {
  const results = runSimulation();
  console.log('\n=== Adversarial Simulation (synthetic twin) ===');
  for (const r of results) {
    console.log(`${r.pass ? '✅ RESISTED' : '❌ FAILED  '}  ${r.id}  — ${r.name}`);
    console.log(`        expected: ${r.expected}`);
    console.log(`        metrics:  ${JSON.stringify(r.metrics)}`);
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios resisted; ${failed.length} failure(s).`);
  if (failed.length) process.exitCode = 1;
  return results;
}

if (require.main === module) main();
module.exports = { runSimulation };
