'use strict';
// Performance & scalability verification (INFORMATIONAL — not gated, non-deterministic
// timings are excluded from the signed evidence digest). Measures throughput/latency
// of hot paths so trends can be tracked over time.
const { build } = require('../platform/orchestrator');
const { ZONES } = require('../zones');
const { sha256 } = require('../util/hash');

function timeit(fn, iterations) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn(i);
  const ns = Number(process.hrtime.bigint() - start);
  const perOpUs = ns / iterations / 1000;
  const opsPerSec = Math.round(1e9 / (ns / iterations));
  return { iterations, perOpUs: Number(perOpUs.toFixed(3)), opsPerSec };
}

function run({ iterations = 20000 } = {}) {
  const t = build();
  const results = {};
  results.policyEvaluate = timeit(() => t.policy.evaluate({ action: 'submit-report' }), iterations);
  results.eventPublishSameZone = timeit((i) => t.bus.publish({ type: 'Ping', sourceZone: ZONES.EXECUTIVE, targetZone: ZONES.EXECUTIVE, payload: { i } }), iterations);
  results.reportSubmit = timeit((i) => t.stores.report.submit({ case_code: 'P' + i, category: 'other', content: 'x' }), Math.min(iterations, 5000));
  results.evidenceDigest = timeit(() => sha256({ a: 1, b: [1, 2, 3] }), iterations);
  return { measuredAt: new Date().toISOString(), results, note: 'Informational; excluded from deterministic evidence digest.' };
}

module.exports = { run };
