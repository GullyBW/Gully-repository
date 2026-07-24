'use strict';
// v1.5 Phase 35 (privacy engineering) + Phase 36 (threat intelligence).
const { test } = require('node:test');
const assert = require('node:assert');
const privacy = require('../src/privacy/privacy-engineering');
const threat = require('../src/security/threat-intel');

test('privacy: PIA, minimization, differential privacy (deterministic), anonymization', () => {
  // PIA flags identity + cross-zone + no purpose.
  const pia = privacy.automatedPIA({ name: 'flow', fields: ['email', 'category'], crossZone: true, retained: true, retentionDays: 9999 });
  assert.strictEqual(pia.pass, false);
  assert.strictEqual(pia.band, 'high');
  assert.ok(/never authorizes/.test(pia.note));
  // Clean flow passes.
  assert.strictEqual(privacy.automatedPIA({ name: 'g', fields: ['category', 'status'], purpose: 'triage' }).pass, true);
  // Minimization.
  assert.strictEqual(privacy.validateMinimization({ category: 'police' }).ok, true);
  assert.strictEqual(privacy.validateMinimization({ omang: '123' }).ok, false);
  // Differential privacy is deterministic and non-negative.
  const a = privacy.dpNoisyCount(100, { epsilon: 0.5, seed: 9 });
  const b = privacy.dpNoisyCount(100, { epsilon: 0.5, seed: 9 });
  assert.strictEqual(a.noisy, b.noisy);
  assert.ok(a.noisy >= 0);
  // Anonymization quality (k-anonymity).
  const rows = [...Array(6)].map(() => ({ category: 'police', recipient: 'ombudsman', status: 'received' }));
  const q = privacy.anonymizationQuality(rows);
  assert.strictEqual(q.kAnonymity, 6);
  assert.strictEqual(q.meetsK, true);
});

test('threat intel: IOC match, device/credential/behaviour risk, bounded trust enrichment', () => {
  const feed = new threat.ThreatFeed();
  feed.ingest([{ indicator: 'hash:abc', type: 'malware', severity: 'high' }]);
  assert.strictEqual(feed.match('hash:abc').hit, true);
  assert.strictEqual(feed.match('hash:xyz').hit, false);
  assert.strictEqual(threat.deviceRisk({ jailbroken: true, patched: false }).band, 'high');
  assert.strictEqual(threat.credentialRisk('h1', new Set(['h1'])).breached, true);
  assert.strictEqual(threat.behavioralAnomaly({ requestsPerMin: 100, baselinePerMin: 10, hourOfDay: 3 }).anomalous, true);
  // Enrichment can ONLY lower trust and never overrides governance.
  const e = threat.enrichTrust(80, { deviceRisk: 100, credentialRisk: 100, anomalyScore: 100 });
  assert.ok(e.enrichedScore < e.baseScore);
  assert.ok(threat.enrichTrust(50, {}).enrichedScore <= 50);
  assert.ok(/never overrides human governance/.test(e.note));
});

test('threat intel: correlation + advisory recommendations', () => {
  const corr = threat.correlate([{ risk: 90 }, { anomalyScore: 70 }]);
  assert.strictEqual(corr.incident, true);
  assert.strictEqual(corr.severity, 'critical');
  assert.strictEqual(corr.advisoryOnly, true);
  const rec = threat.recommend({ deviceRiskBand: 'high', credentialBreached: true, anomalous: true });
  assert.strictEqual(rec.recommendations.length, 3);
  assert.strictEqual(rec.autonomous, false);
});
