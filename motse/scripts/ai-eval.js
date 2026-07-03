'use strict';

/**
 * AI quality report (Phase 3, WS9). Runs the evaluation datasets through
 * the registered providers and prints a scorecard; exits nonzero if any
 * metric is below threshold so it gates a release in CI.
 *   node motse/scripts/ai-eval.js
 */
process.env.MOTSE_LOG_LEVEL = 'silent';
const { createPlatform } = require('../src/container');

const p = createPlatform();
const report = p.aiEvaluator.evaluate('ci:ai-eval');

// eslint-disable-next-line no-console
console.log('AI quality report', report.generated_at);
for (const [metric, m] of Object.entries(report.metrics)) {
  // eslint-disable-next-line no-console
  console.log(
    `  ${metric.padEnd(16)} score ${String(m.score).padEnd(6)} threshold ${m.threshold}  ${m.pass ? 'PASS' : 'FAIL'}  (n=${m.n}, ${m.detail})`
  );
}
// eslint-disable-next-line no-console
console.log(report.passed ? 'PASS: all metrics above threshold' : 'FAIL: AI quality regression');
process.exit(report.passed ? 0 : 1);
