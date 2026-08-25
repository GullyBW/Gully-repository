'use strict';
// v1.5 Phase 32 (metadata), Phase 38 (capability model), Phase 39 (developer platform),
// Phase 40 (maturity intelligence).
const { test } = require('node:test');
const assert = require('node:assert');
const { MetadataGovernance } = require('../src/fabric/metadata');
const capability = require('../src/capability/model');
const maturity = require('../src/maturity/maturity');
const devplatform = require('../src/devplatform/sdk');
const openapi = require('../src/openapi');
const { DataLineage } = require('../src/fabric/registry');

test('metadata governance: classification, versioning, quality, stewardship, provenance', () => {
  const lin = new DataLineage(); lin.record('reports', 'cases', 'project');
  const md = new MetadataGovernance({ clock: () => 1, lineage: lin });
  md.register('cases', { owner: 'independent', steward: 'data-steward', classification: 'restricted', tags: ['non-identifying'] });
  assert.strictEqual(md.describe('cases').version, 1);
  md.register('cases', { owner: 'independent', classification: 'restricted' }); // re-register → v2
  assert.strictEqual(md.describe('cases').version, 2);
  assert.throws(() => md.register('x', { classification: 'bogus' }), /invalid classification/);
  const q = md.recordQuality('cases', { completeness: 0.9, validity: 1, timeliness: 0.8 });
  assert.ok(q.score > 0.8);
  assert.deepStrictEqual(md.search({ classification: 'restricted' }).map((d) => d.id), ['cases']);
  assert.ok(md.provenance('cases').some((p) => p.dataset === 'reports'));
});

test('capability model: map, dependencies, ownership, live heat map', () => {
  assert.ok(Object.keys(capability.capabilityMap()).length >= 8);
  assert.deepStrictEqual(capability.dependencies()['Case Management'], ['Anonymous Reporting']);
  assert.ok(capability.ownership().Security.includes('Identity & Access'));
  const hm = capability.heatMap([{ id: 'FIT-IDENTITY-MINIMIZATION', pass: true }, { id: 'APP-FIT-ANONYMITY-BOUNDARY', pass: true }]);
  assert.strictEqual(hm['Anonymous Reporting'].status, 'healthy');
  const degraded = capability.heatMap([{ id: 'FIT-IDENTITY-MINIMIZATION', pass: false }, { id: 'APP-FIT-ANONYMITY-BOUNDARY', pass: true }]);
  assert.strictEqual(degraded['Anonymous Reporting'].status, 'degraded');
});

test('maturity intelligence: capped by automation, human-gated, technical-debt signal', () => {
  const all = [...Array(50)].map((_, i) => ({ id: `FIT-${i}`, pass: true }));
  const m = maturity.assess({ twin: all.slice(0, 14), app: all.slice(14, 45), infra: all.slice(45), docs: 20 });
  assert.ok(m.overallLevel <= m.automationCap);
  assert.strictEqual(m.humanGate.required, true);
  assert.ok(/require human attestation/.test(m.humanGate.note));
  // Technical debt reflects failures.
  const withDebt = maturity.assess({ app: [{ id: 'APP-FIT-X', pass: false }] });
  assert.strictEqual(withDebt.technicalDebt.openInvariantFailures, 1);
});

test('developer platform: deterministic SDK, mock service, integration template, harness', () => {
  const spec = openapi.spec();
  const sdk = devplatform.generateClientSdk(spec);
  assert.strictEqual(sdk, devplatform.generateClientSdk(spec)); // deterministic
  assert.ok(sdk.includes('class NjtipClient'));
  assert.ok(sdk.includes('submitReport'));
  // Mock service returns documented-shape stubs.
  const mock = devplatform.mockService(spec);
  assert.strictEqual(mock.handle('GET', '/api/twin/validate').status, 200);
  assert.strictEqual(mock.handle('GET', '/nope').status, 404);
  // Integration template + harness.
  assert.ok(devplatform.integrationTemplate('persistence').includes('Adapter'));
  assert.strictEqual(devplatform.testHarness(spec).ok, true);
});
