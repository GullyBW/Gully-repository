'use strict';
const { checks } = require('./modelcheck');

function list() {
  return checks.map((c) => ({ id: c.id }));
}

function runAll() {
  return checks.map((c) => c.run());
}

module.exports = { checks, list, runAll };
