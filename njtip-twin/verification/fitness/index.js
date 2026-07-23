'use strict';
// Registry of all executable architecture fitness functions. Each converts an
// approved architectural invariant into a check that returns pass/violations.
// A failing check == an architecture violation == a failing build.
module.exports = [
  require('./zone-isolation'),
  require('./identity-minimization'),
  require('./least-privilege'),
  require('./policy-enforcement'),
  require('./zero-trust'),
  require('./secure-data-flows'),
  require('./encryption'),
  require('./auditability'),
  require('./governance'),
  require('./chain-of-custody'),
  require('./emergency'),
  require('./backup'),
  require('./time-integrity'),
  require('./traceability-coverage'),
];
