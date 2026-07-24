'use strict';
// Invoke the Digital Engineering Twin's fitness gate from the running product.
// This keeps the Twin as the permanent, in-process assurance mechanism.
const { build } = require('../../njtip-twin/src/platform/orchestrator');
const fitness = require('../../njtip-twin/verification/fitness');

function twinValidate() {
  const twin = build();
  const results = fitness.map((f) => f.check(twin));
  return {
    invariantsHeld: results.every((r) => r.pass),
    passed: results.filter((r) => r.pass).length, total: results.length,
    failing: results.filter((r) => !r.pass).map((r) => r.id),
    note: 'Architecture invariants continuously verified by the Digital Engineering Twin. Evidence ≠ authorization.',
  };
}
function invariantsHeld() { return twinValidate().invariantsHeld; }

module.exports = { twinValidate, invariantsHeld };
