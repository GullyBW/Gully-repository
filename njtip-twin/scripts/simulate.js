'use strict';
// Adversarial simulation runner (full v0.2 suite). Exit non-zero if any scenario
// is not resisted.
const { build } = require('../src/platform/orchestrator');
const adversarial = require('../adversarial');

function runSimulation() {
  return adversarial.runAll((opts) => build(opts));
}

function main() {
  const results = runSimulation();
  console.log('\n=== Adversarial Simulation (synthetic twin) ===');
  for (const r of results) {
    console.log(`${r.pass ? '✅ RESISTED' : '❌ FAILED  '}  ${r.id}  — ${r.name}`);
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios resisted; ${failed.length} failure(s).`);
  if (failed.length) process.exitCode = 1;
  return results;
}

if (require.main === module) main();
module.exports = { runSimulation };
