'use strict';
// Invoke BOTH assurance gates from the running product:
//   (1) the Digital Engineering Twin's fitness gate (shared domain invariants), and
//   (2) the application-level fitness gate (this product's production adapters +
//       domain lifecycles).
// Together they keep the Twin as the permanent assurance mechanism AND verify the
// product-specific invariants introduced by the production transition.
const { build } = require('../../njtip-twin/src/platform/orchestrator');
const twinFitness = require('../../njtip-twin/verification/fitness');
const appFitness = require('../verification/app-fitness');

function runTwin() {
  const twin = build();
  return twinFitness.map((f) => f.check(twin));
}
function runApp() {
  return appFitness.map((f) => f.check());
}

function twinValidate() {
  const twin = runTwin();
  const app = runApp();
  const all = [...twin, ...app];
  return {
    invariantsHeld: all.every((r) => r.pass),
    passed: all.filter((r) => r.pass).length, total: all.length,
    twin: { passed: twin.filter((r) => r.pass).length, total: twin.length },
    app: { passed: app.filter((r) => r.pass).length, total: app.length },
    failing: all.filter((r) => !r.pass).map((r) => r.id),
    note: 'Architecture invariants continuously verified by the Twin AND the app fitness gate. Evidence ≠ authorization.',
  };
}
function invariantsHeld() { return twinValidate().invariantsHeld; }

module.exports = { twinValidate, invariantsHeld, runTwin, runApp };
