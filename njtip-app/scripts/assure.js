'use strict';
// Product-side assurance hook: run the Digital Engineering Twin's fitness gate as the
// product's quality gate. Blocks (exit 1) if any architectural invariant fails.
const { build } = require('../../njtip-twin/src/platform/orchestrator');
const fitness = require('../../njtip-twin/verification/fitness');

function main() {
  const twin = build();
  const results = fitness.map((f) => f.check(twin));
  const failing = results.filter((r) => !r.pass);
  console.log(`Digital Engineering Twin fitness: ${results.length - failing.length}/${results.length} invariants hold.`);
  for (const f of failing) console.log(`  ❌ ${f.id}: ${f.violations.join('; ')}`);
  if (failing.length) { console.error('❌ Architecture invariants violated — product build blocked.'); process.exitCode = 1; }
  else console.log('✅ Architecture invariants hold. (Evidence ≠ authorization; go-live remains a human decision.)');
}
if (require.main === module) main();
