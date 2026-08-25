'use strict';
// v1.6 Phase 46 (responsible AI governance) + Phase 47 (cryptographic agility).
const { test } = require('node:test');
const assert = require('node:assert');
const { AiRegistry, governedRecommendation } = require('../src/ai/ai-governance');
const advisor = require('../src/ai/advisor');
const { makeCryptoAgility, CryptoPolicyRegistry } = require('../src/adapters/crypto-agility');

test('AI governance: no model operates without approval; approval needs a human + rationale', () => {
  const reg = new AiRegistry({ clock: () => 1 });
  reg.register('priority', { owner: 'analytics', purpose: 'prioritisation' });
  assert.strictEqual(reg.canOperate('priority').allowed, false);
  assert.throws(() => governedRecommendation(reg, 'priority', advisor.riskScore({ category: 'police' })), /may not operate/);
  assert.throws(() => reg.approve('priority', { by: 'x' }), /rationale/);
  reg.approve('priority', { by: 'AI Board', rationale: 'explainable + advisory' });
  assert.strictEqual(reg.canOperate('priority').allowed, true);
  // A governed recommendation from an approved model still requires human approval.
  const g = governedRecommendation(reg, 'priority', advisor.riskScore({ category: 'police' }));
  assert.strictEqual(g.requiresHumanApproval, true);
  assert.ok(reg.auditTrail().some((a) => a.event === 'approved'));
});

test('AI governance: explainability, drift detection, bias monitoring', () => {
  const reg = new AiRegistry();
  reg.register('m', { owner: 'o', purpose: 'p' });
  assert.strictEqual(reg.validateExplainability('m', advisor.riskScore({ category: 'police' })).explainable, true);
  assert.strictEqual(reg.validateExplainability('m', { advisoryOnly: false }).explainable, false);
  reg.setBaseline('m', { accuracy: 0.9 });
  reg.recordMetrics('m', { accuracy: 0.7 });
  assert.strictEqual(reg.detectDrift('m', { threshold: 0.1 }).drift, true);
  const bias = reg.monitorBias('m', { south: { positive: 8, total: 10 }, north: { positive: 2, total: 10 } }, { threshold: 0.2 });
  assert.strictEqual(bias.flagged, true);
  assert.ok(/human review required/.test(bias.note));
});

test('crypto agility: policy registry, algorithm migration overlap, PQ readiness, key lifecycle', () => {
  const reg = new CryptoPolicyRegistry();
  assert.ok(reg.permitted('signature').includes('ed25519'));
  assert.strictEqual(reg.isPermitted('signature', 'rsa-2048'), false); // deprecated
  // PQ readiness is interface-declared.
  assert.strictEqual(reg.pqReadiness().byPurpose.signature.ready, true);
  assert.ok(/human-built/.test(reg.pqReadiness().note));
  // Migration keeps the legacy algorithm valid during the overlap.
  const ca = makeCryptoAgility();
  const prov = ca.provider('signature');
  const old = prov.primary();
  prov.migrate('ml-dsa-65');
  assert.strictEqual(prov.primary(), 'ml-dsa-65');
  assert.strictEqual(prov.accepts(old), true);      // legacy still accepted
  assert.strictEqual(prov.accepts('unknown'), false);
  // Key lifecycle governance (over references, never material).
  ca.keys.register('k1', { algo: 'ed25519' });
  ca.keys.beginRotation('k1', 'k2', 'ml-dsa-65');
  assert.strictEqual(ca.keys.retire('k1').state, 'retired');
  assert.ok(ca.keys.inventory().some((k) => k.keyRef === 'k2'));
  // No key material anywhere.
  assert.ok(!JSON.stringify(ca.keys.inventory()).includes('PRIVATE'));
});
