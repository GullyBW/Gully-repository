'use strict';
// Aggregated adversarial simulation suite: the original core (scenarios.js) plus
// the expanded v0.2 library (library.js).
const { scenarios: core } = require('./scenarios');
const { library } = require('./library');

const all = [...core, ...library];

function list() {
  return all.map((s) => ({ id: s.id, threats: s.threats }));
}

function runAll(build) {
  return all.map((s) => s.run(build));
}

module.exports = { scenarios: all, list, runAll };
