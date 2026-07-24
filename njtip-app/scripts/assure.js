'use strict';
// Product-side assurance hook: run BOTH the Digital Engineering Twin's fitness gate AND
// the application-level fitness gate as the product's quality gate. Blocks (exit 1) if any
// architectural invariant fails, at the Twin layer or the app layer.
const { build } = require('../../njtip-twin/src/platform/orchestrator');
const twinFitness = require('../../njtip-twin/verification/fitness');
const appFitness = require('../verification/app-fitness');

function report(label, results) {
  const failing = results.filter((r) => !r.pass);
  console.log(`${label}: ${results.length - failing.length}/${results.length} invariants hold.`);
  for (const f of failing) console.log(`  ❌ ${f.id}: ${f.violations.join('; ')}`);
  return failing.length;
}

function main() {
  const twin = build();
  const twinFailing = report('Digital Engineering Twin fitness', twinFitness.map((f) => f.check(twin)));
  const appFailing = report('Application fitness', appFitness.map((f) => f.check()));
  if (twinFailing + appFailing) { console.error('❌ Architecture invariants violated — product build blocked.'); process.exitCode = 1; }
  else console.log('✅ All architecture invariants hold. (Evidence ≠ authorization; go-live remains a human decision.)');
}
if (require.main === module) main();
