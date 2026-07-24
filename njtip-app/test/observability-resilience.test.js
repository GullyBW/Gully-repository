'use strict';
// v1.3 Phase 5 + 7: distributed tracing, SLO/error-budget alerting, and the
// performance/soak/chaos resilience harness.
const { test } = require('node:test');
const assert = require('node:assert');
const { Tracer, parseTraceparent } = require('../src/adapters/observability');
const slo = require('../src/observability/slo');
const { soakCheck, chaosCheck, loadTest } = require('../scripts/perf');

test('tracer: spans link to parents, propagate via traceparent, and redact attrs', () => {
  let now = 0;
  const tr = new Tracer({ clock: () => (now += 5) });
  const root = tr.startSpan('http.request', { attrs: { method: 'GET', email: 'a@b.c' } });
  // Identity attributes are redacted (defence in depth).
  assert.strictEqual(root.attrs.email, '***REDACTED***');
  const tp = root.traceparent();
  const parsed = parseTraceparent(tp);
  assert.strictEqual(parsed.traceId, root.traceId);
  // A downstream service continues the trace.
  const child = tr.startSpan('db.query', { traceparent: tp });
  assert.strictEqual(child.traceId, root.traceId);
  assert.strictEqual(child.parentId, root.spanId);
  root.end(); child.end();
  assert.strictEqual(tr.forTrace(root.traceId).length, 2);
});

test('SLO: error budget + alerts (fast burn pages, slow burn tickets)', () => {
  // Healthy: 1000 requests, 1 failure, all fast.
  const healthy = slo.evaluate(slo.computeSlis({ total: 1000, failed: 1, latencies: Array(1000).fill(50) }));
  assert.strictEqual(healthy.healthy, true);
  assert.strictEqual(healthy.alerts.length, 0);
  // Availability breach: 10% failures → budget (0.5%) massively consumed → page.
  const breached = slo.evaluate(slo.computeSlis({ total: 1000, failed: 100, latencies: Array(1000).fill(50) }));
  assert.strictEqual(breached.healthy, false);
  assert.ok(breached.alerts.some((a) => a.slo === 'availability' && a.severity === 'page'));
  // Alert correlation → one incident.
  const incident = slo.correlate(breached.alerts);
  assert.strictEqual(incident.incident, true);
});

test('resilience harness: soak holds integrity; chaos degrades gracefully + recovers', () => {
  const soak = soakCheck(120);
  assert.strictEqual(soak.pass, true, soak.problems.join('; '));
  const chaos = chaosCheck();
  assert.strictEqual(chaos.pass, true, chaos.problems.join('; '));
});

test('load test runs the real workflow and integrity holds', () => {
  const r = loadTest(200);
  assert.strictEqual(r.iterations, 200);
  assert.strictEqual(r.integrityHeld, true);
  assert.ok(r.throughputPerSec > 0);
  assert.ok(r.latencyMs.p95 >= 0);
});
