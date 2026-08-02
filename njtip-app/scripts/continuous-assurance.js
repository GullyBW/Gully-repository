'use strict';
// Continuous Assurance (Phase 10, Part 15). Evaluates all sixteen assurance domains against the
// live platform and prints the deployment authorization package.
//
// FAIL-CLOSED: a failed domain exits non-zero and blocks the pipeline. A clean run exits zero —
// and still does NOT authorize a deployment. Go-live is a recorded human decision.
//
// Usage: node scripts/continuous-assurance.js [--production-readiness]
const { createApp } = require('../src/app');

function main() {
  const app = createApp();
  const production = process.argv.includes('--production-readiness');
  const pkg = production ? app.assurance.productionReadiness() : app.assurance.authorizationPackage();
  console.log(JSON.stringify(pkg, null, 2));
  const { passed, total } = pkg.assurance;
  console.log(`\nAssurance domains: ${passed}/${total} · readiness ${pkg.readiness.score} (${pkg.readiness.band})`);
  if (pkg.riskRegister.open) console.log(`Risk register: ${pkg.riskRegister.open} open item(s).`);
  console.log(pkg.clean
    ? `✅ ${pkg.gateOutcome}\n🔒 ${pkg.authorizationDecision}`
    : `❌ ${pkg.gateOutcome}\n   Blockers: ${pkg.blockers.map((b) => b.blocker).join('; ')}`);
  if (production) console.log(`\n${pkg.outstandingHumanItems} item(s) require a named human before production:\n` + pkg.humanItems.map((i) => `  · ${i.item} — ${i.detail}`).join('\n'));
  process.exitCode = pkg.clean ? 0 : 1;
}
if (require.main === module) main();
module.exports = { main };
