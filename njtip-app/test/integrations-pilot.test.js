'use strict';
// v1.3 Phase 6 (external integrations behind stable contracts, isolated by circuit
// breakers) + Phase 10 (feature flags for controlled pilot rollout) + Phase 9 (assurance
// evidence organised by independent-review domain).
const { test } = require('node:test');
const assert = require('node:assert');
const { IntegrationGateway, CircuitBreaker, CaptureIntegrationClient } = require('../src/adapters/integrations');
const { FeatureFlags } = require('../src/adapters/flags');
const { buildCore } = require('../scripts/evidence-package');

test('integration gateway: PII-free outbound; delivers to the registered client', () => {
  const gw = new IntegrationGateway();
  const client = new CaptureIntegrationClient();
  gw.register('dms', client);
  const r = gw.send('dms', { caseCode: 'NJ-1', action: 'archive' });
  assert.strictEqual(r.accepted, true);
  assert.strictEqual(client.sent().length, 1);
  // Identity/content is refused outbound (fail-closed).
  assert.throws(() => gw.send('dms', { email: 'a@b.c' }), /refuses PII/);
  assert.throws(() => gw.send('dms', { meta: { content: 'secret' } }), /refuses PII/);
  assert.throws(() => gw.send('unknown', {}), /unknown integration/);
});

test('circuit breaker: closed → open → half-open → closed', () => {
  let now = 0;
  const cb = new CircuitBreaker({ clock: () => now, failureThreshold: 2, cooldownMs: 100 });
  const boom = () => { throw new Error('down'); };
  assert.strictEqual(cb.state(), 'closed');
  try { cb.call(boom); } catch (_) {}
  try { cb.call(boom); } catch (_) {}
  assert.strictEqual(cb.state(), 'open'); // threshold reached
  // Fails fast while open.
  assert.throws(() => cb.call(() => 1), /circuit-open/);
  now += 150; // cooldown elapsed
  assert.strictEqual(cb.state(), 'half-open');
  assert.strictEqual(cb.call(() => 42), 42); // success closes
  assert.strictEqual(cb.state(), 'closed');
});

test('feature flags: deterministic sticky rollout, cohorts, kill-switch, identity-free', () => {
  const ff = new FeatureFlags({ canary: { rolloutPct: 50 }, pilot: { cohorts: ['pilot-internal'] } });
  // Sticky: same subject → same answer, both calls.
  const d1 = ff.isEnabled('canary', { subject: 'case-abc' });
  const d2 = ff.isEnabled('canary', { subject: 'case-abc' });
  assert.strictEqual(d1, d2);
  // Cohort gating.
  assert.strictEqual(ff.isEnabled('pilot', { cohort: 'pilot-internal' }), true);
  assert.strictEqual(ff.isEnabled('pilot', { cohort: 'public' }), false);
  // Kill-switch.
  ff.set('canary', { enabled: false, rolloutPct: 100 });
  assert.strictEqual(ff.isEnabled('canary', { subject: 'x' }), false);
});

test('evidence package: assessment domains map to concrete controls (Phase 9)', () => {
  const core = buildCore();
  const d = core.assessmentDomains;
  for (const domain of ['software-architecture', 'cybersecurity', 'privacy', 'governance', 'legal-compliance', 'risk-management', 'operational-readiness', 'engineering-quality']) {
    assert.ok(Array.isArray(d[domain]) && d[domain].length > 0, 'missing domain ' + domain);
  }
  // Every referenced control id exists in the fitness results (no dangling references).
  const known = new Set([...core.fitness.twin, ...core.fitness.app, ...core.fitness.infra].map((r) => r.id));
  for (const [domain, ids] of Object.entries(d)) {
    for (const id of ids) assert.ok(known.has(id), `${domain} references unknown control ${id}`);
  }
});
