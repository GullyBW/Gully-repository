'use strict';
// Phase 8 — Historical engineering analytics + a (heuristic) predictive health signal.
// Aggregates the combined fitness gate (twin + app + infra) into an engineering-health
// score, appends it to a history log, and reports a simple trend. The "prediction" is an
// explicit, transparent heuristic (linear trend of recent scores) — NOT a model and NOT a
// go/no-go. Deployment approval always remains a human governance decision.
//
// Usage:
//   node scripts/engineering-health.js            # print current health + trend
//   node scripts/engineering-health.js --record    # also append to the history log
const fs = require('node:fs');
const path = require('node:path');
const { runTwin, runApp, runInfra } = require('../src/twin-validate');

const HISTORY = path.join(__dirname, '..', 'verification', 'engineering-health-history.json');

function currentHealth() {
  const layers = { twin: runTwin(), app: runApp(), infra: runInfra() };
  const dims = {};
  let passed = 0, total = 0;
  for (const [name, results] of Object.entries(layers)) {
    const p = results.filter((r) => r.pass).length;
    dims[name] = { passed: p, total: results.length, failing: results.filter((r) => !r.pass).map((r) => r.id) };
    passed += p; total += results.length;
  }
  const score = total ? +(passed / total).toFixed(4) : 0;
  return { score, passed, total, dims };
}

// Transparent linear trend over the last N recorded scores (slope > 0 improving).
function trend(history, current) {
  const scores = [...history.map((h) => h.score), current.score].slice(-10);
  if (scores.length < 2) return { direction: 'flat', slope: 0, basis: scores.length };
  const n = scores.length; const xs = scores.map((_, i) => i);
  const mx = (n - 1) / 2; const my = scores.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (scores[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den ? num / den : 0;
  return { direction: slope > 1e-6 ? 'improving' : slope < -1e-6 ? 'declining' : 'flat', slope: +slope.toFixed(5), basis: n };
}

function main() {
  const record = process.argv.includes('--record');
  let history = []; try { history = JSON.parse(fs.readFileSync(HISTORY, 'utf8')); } catch (_) { history = []; }
  const current = currentHealth();
  const tr = trend(history, current);
  const report = {
    platform: 'NJTIP', kind: 'engineering-health',
    score: current.score, grade: current.score >= 1 ? 'A' : current.score >= 0.95 ? 'B' : current.score >= 0.9 ? 'C' : 'D',
    dims: current.dims, trend: tr,
    prediction: { method: 'linear-trend-heuristic', note: 'Transparent heuristic over recent scores. Not a model, not an authorization.', outlook: tr.direction },
    note: 'Evidence ≠ authorization. Deployment approval is always a human governance decision.',
  };
  if (record) {
    history.push({ at: new Date().toISOString(), score: current.score, passed: current.passed, total: current.total });
    fs.writeFileSync(HISTORY, JSON.stringify(history.slice(-200), null, 2));
    console.error(`Recorded engineering-health score ${current.score} (${history.length} points).`);
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = current.score >= 1 ? 0 : 1;
}
if (require.main === module) main();

module.exports = { currentHealth, trend };
