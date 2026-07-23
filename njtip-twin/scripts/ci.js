'use strict';
// Continuous Verification pipeline gate. On every change, CI runs:
//   1. architecture verification (fitness functions)
//   2. adversarial simulation
//   3. evidence generation (machine-verifiable, review-ready)
// and BLOCKS (exit 1) if any critical invariant fails or any scenario is not resisted.
const path = require('node:path');
const { runVerification } = require('./verify');
const { runSimulation } = require('./simulate');
const { buildBundle, writeBundle } = require('../src/evidence/evidence');

function main() {
  const verification = runVerification();
  const adversarial = runSimulation();
  const bundle = buildBundle({ verification, adversarial });
  const outDir = path.join(__dirname, '..', 'evidence-out');
  const written = writeBundle(bundle, outDir);

  console.log('\n=== Continuous Verification Gate ===');
  console.log(`Fitness passed:        ${bundle.summary.fitnessPassed}/${bundle.summary.fitnessTotal}`);
  console.log(`Critical failures:     ${bundle.summary.criticalFailures}`);
  console.log(`Adversarial resisted:  ${bundle.summary.adversarialResisted}/${bundle.summary.adversarialTotal}`);
  console.log(`Content digest:        ${bundle.meta.contentDigest}`);
  console.log(`Evidence written:      ${path.relative(process.cwd(), written.json)} , ${path.relative(process.cwd(), written.md)}`);
  console.log(`Verdict:               ${bundle.verdict.allCriticalInvariantsHold && bundle.verdict.allAdversarialScenariosResisted ? 'INVARIANTS HOLD (evidence only — human gate required)' : 'BLOCKED'}`);

  const blocked = bundle.summary.criticalFailures > 0 || bundle.summary.adversarialFailures > 0;
  if (blocked) {
    console.error('\n❌ Continuous Verification FAILED — deployment blocked.');
    process.exitCode = 1;
  } else {
    console.log('\n✅ Continuous Verification passed — evidence generated for human review.');
    console.log('   (This is NOT a production go-live approval. See humanReviewRequired in evidence.json.)');
  }
}

if (require.main === module) main();
module.exports = { main };
