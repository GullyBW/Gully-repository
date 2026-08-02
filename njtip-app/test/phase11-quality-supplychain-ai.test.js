'use strict';
// Phase 11, Parts 7, 8 & 9 — enterprise data-quality governance, advanced supply-chain security,
// and comprehensive AI governance.
const test = require('node:test');
const assert = require('node:assert');
const dgm = require('../src/fabric/data-governance');
const slsa = require('../src/supplychain/slsa');
const aim = require('../src/ai/ai-lifecycle');

const { DataGovernance, seedPlatformDatasets, measurePlatformQuality, OBSERVED_DIMENSIONS, DERIVED_DIMENSIONS } = dgm;
const { SupplyChainAttestation, TransparencyLog, licenseVerdict, LICENSE_POLICY, TRUST_THRESHOLD } = slsa;
const { AiLifecycle, RISK_CLASSES, DATASET_QUALITY_DIMENSIONS } = aim;

const IDENTITY = 'https://github.com/gov/njtip/.github/workflows/release.yml@refs/tags/v1.10.0';
const ISSUER = 'https://token.actions.githubusercontent.com';
const GOOD = Object.fromEntries(OBSERVED_DIMENSIONS.map((d) => [d, 0.99]));

// --- Part 7: data quality governance ------------------------------------------------------------

test('data quality: eight dimensions, two of which cannot be entered by hand', () => {
  assert.strictEqual(dgm.QUALITY_DIMENSIONS.length, 8);
  assert.deepStrictEqual(DERIVED_DIMENSIONS, ['lineageCompleteness', 'metadataCompleteness']);
  const dg = seedPlatformDatasets(new DataGovernance({ clock: () => 1_000_000 }));
  for (const d of DERIVED_DIMENSIONS) {
    assert.throws(() => dg.observeQuality('case-records', { [d]: 1 }), /derived from the governance model/);
  }
  assert.throws(() => dg.observeQuality('case-records', { completeness: 1.5 }), /\[0, 1\]/);
  assert.throws(() => dg.observeQuality('case-records', { plausibility: 1 }), /unknown quality dimension/);
});

test('data quality: derived dimensions are computed from the record and can fall below 1', () => {
  const dg = seedPlatformDatasets(new DataGovernance({ clock: () => 1_000_000 }));
  for (const id of dg.datasets()) {
    const d = dg.deriveQualityDimensions(id);
    assert.strictEqual(d.lineageCompleteness, 1, `${id} lineage: ${d.lineageGaps.join(', ')}`);
    assert.strictEqual(d.metadataCompleteness, 1, `${id} metadata: ${d.missingMetadata.join(', ')}`);
  }
  const gapped = new DataGovernance({ clock: () => 1_000_000 });
  gapped.register('orphan', { origin: 'somewhere', classification: 'internal', retentionClass: 'telemetry', purpose: 'unstated-analysis' });
  const g = gapped.deriveQualityDimensions('orphan');
  assert.ok(g.lineageCompleteness < 1);
  assert.ok(g.metadataCompleteness < 1);
  assert.ok(g.lineageGaps.includes('consumersDeclared'));
});

test('data quality: an unmeasured dataset is not a clean one and reduces readiness', () => {
  const dg = seedPlatformDatasets(new DataGovernance({ clock: () => 1_000_000 }));
  const q = dg.qualityScore('case-records');
  assert.strictEqual(q.measured, false);
  assert.strictEqual(q.meets, false);
  assert.strictEqual(q.readinessImpact, 1);
  assert.strictEqual(dg.governanceReadiness().qualityReadiness, 0);
  assert.strictEqual(dg.governanceReadiness().acceptable, false);
});

test('data quality: poor quality reduces governance readiness and raises an owned alert', () => {
  let now = 1_000_000;
  const dg = seedPlatformDatasets(new DataGovernance({ clock: () => now }));
  for (const id of dg.datasets()) dg.observeQuality(id, GOOD, { recordCount: 10 });
  const healthy = dg.governanceReadiness();
  assert.strictEqual(healthy.qualityReadiness, 1);
  assert.strictEqual(healthy.acceptable, true);
  assert.deepStrictEqual(healthy.alerts, []);

  now += 24 * 3600_000;
  dg.observeQuality('case-records', Object.fromEntries(OBSERVED_DIMENSIONS.map((d) => [d, 0.3])), { recordCount: 10 });
  const degraded = dg.governanceReadiness();
  assert.ok(degraded.qualityReadiness < 1);
  assert.strictEqual(degraded.acceptable, false);
  const alert = degraded.alerts.find((a) => a.dataset === 'case-records');
  assert.strictEqual(alert.severity, 'critical');
  assert.ok(alert.owner, 'an unowned alert is an unowned dataset');
  assert.strictEqual(dg.qualityTrend('case-records').direction, 'degrading');
});

test('data quality: an empty dataset is not-applicable, never a quality achievement', () => {
  const dg = seedPlatformDatasets(new DataGovernance({ clock: () => 1_000_000 }));
  dg.observeQuality('evidence-refs', GOOD, { recordCount: 0 });
  const q = dg.qualityScore('evidence-refs');
  assert.strictEqual(q.band, 'not-applicable');
  assert.strictEqual(q.readinessImpact, 0);
  assert.match(q.note, /not the same as good quality/);
});

test('data quality: remediation needs a named human, a bounded date and evidence to close', () => {
  let now = 1_000_000;
  const dg = seedPlatformDatasets(new DataGovernance({ clock: () => now }));
  assert.throws(() => dg.openRemediation('case-records', { dimension: 'accuracy', dueInDays: 10 }), /named human/);
  assert.throws(() => dg.openRemediation('case-records', { dimension: 'accuracy', by: 'DGB', dueInDays: 400 }), /within 365 days/);
  const t = dg.openRemediation('case-records', { dimension: 'accuracy', by: 'DGB Chair', dueInDays: 10 });
  assert.strictEqual(t.state, 'open');
  assert.throws(() => dg.closeRemediation(t.id, { by: 'DGB Chair' }), /without evidence/);
  now += 20 * 24 * 3600_000;
  assert.strictEqual(dg.overdueRemediations().length, 1);
  assert.ok(dg.governanceReadiness().blockers.some((b) => b.startsWith(t.id)));
  assert.strictEqual(dg.closeRemediation(t.id, { by: 'DGB Chair', evidence: 're-profiled' }).state, 'closed');
  assert.throws(() => dg.closeRemediation(t.id, { by: 'x', evidence: 'y' }), /already closed/);
});

test('data quality: the platform measures its own estate, and defects show up', () => {
  const live = seedPlatformDatasets(new DataGovernance({ clock: () => 1_000_000 }));
  measurePlatformQuality(live, {
    cases: [{ caseCode: 'NJ-1', status: 'received', category: 'police' }],
    events: [{ seq: 1, meta: { at: 1 } }], decisions: [{ seq: 0, reviewer: 'OB', verdict: 'defer', rationale: 'await legal' }],
    evidenceCount: 0, chainIntact: true, custodyIntact: true, replayAgrees: true,
  });
  assert.strictEqual(live.governanceReadiness().qualityReadiness, 1);

  const broken = seedPlatformDatasets(new DataGovernance({ clock: () => 1_000_000 }));
  measurePlatformQuality(broken, {
    cases: [{ caseCode: 'NJ-1', status: 'received', category: 'not-a-category' }, { caseCode: 'NJ-1', status: 'received', category: 'police' }],
    events: [{ seq: 1, meta: { at: 1 } }], decisions: [{ seq: 0, reviewer: 'OB', verdict: 'defer' }],
    evidenceCount: 3, chainIntact: false, custodyIntact: false, replayAgrees: false,
  });
  const cr = broken.qualityScore('case-records');
  assert.ok(cr.dimensions.validity < 1, 'an out-of-vocabulary category must reduce validity');
  assert.ok(cr.dimensions.uniqueness < 1, 'a duplicate case code must reduce uniqueness');
  assert.strictEqual(cr.dimensions.accuracy, 0, 'a broken event chain zeroes accuracy');
  assert.ok(broken.qualityScore('oversight-aggregates').score <= cr.score, 'an aggregate cannot be cleaner than its source');
  assert.strictEqual(broken.governanceReadiness().acceptable, false);
});

// --- Part 8: advanced supply chain security -----------------------------------------------------

test('supply chain: keyless signatures survive certificate expiry via the transparency log', () => {
  let now = 1_000_000;
  const sc = new SupplyChainAttestation({ clock: () => now });
  const bundle = sc.keylessSign({ digest: 'artifact-1', identity: IDENTITY, issuer: ISSUER });
  assert.strictEqual(bundle.logEntry.logIndex, 0);
  now += 3600_000;
  const v = sc.verifyBundle(bundle, { expectedIdentity: IDENTITY, expectedIssuer: ISSUER });
  assert.strictEqual(v.valid, true, v.reason);
  assert.strictEqual(v.certificateExpired, true, 'the keyless model is only exercised once the cert has expired');
});

test('supply chain: every keyless verification failure mode is caught', () => {
  const sc = new SupplyChainAttestation({ clock: () => 1_000_000 });
  const bundle = sc.keylessSign({ digest: 'artifact-1', identity: IDENTITY, issuer: ISSUER });
  assert.strictEqual(sc.verifyBundle(bundle, { expectedIdentity: 'attacker' }).valid, false);
  assert.strictEqual(sc.verifyBundle(bundle, { expectedIssuer: 'https://attacker.example' }).valid, false);
  const tampered = JSON.parse(JSON.stringify(bundle)); tampered.certificate.identity = 'attacker';
  assert.strictEqual(sc.verifyBundle(tampered).valid, false);
  const unlogged = JSON.parse(JSON.stringify(bundle)); unlogged.logEntry = null;
  assert.strictEqual(sc.verifyBundle(unlogged).valid, false);
  const late = JSON.parse(JSON.stringify(bundle)); late.logEntry.loggedAt = bundle.certificate.notAfter + 1;
  assert.strictEqual(sc.verifyBundle(late).valid, false);
  assert.throws(() => sc.keylessSign({ digest: 'x', identity: 'i', issuer: 's', ttlMs: 86_400_000 }), /defeats keyless signing/);
  assert.throws(() => sc.keylessSign({ digest: 'x' }), /workflow identity/);
});

test('supply chain: altering the transparency log breaks every inclusion proof after it', () => {
  const log = new TransparencyLog({ clock: () => 5 });
  log.append({ digest: 'd1', identity: 'i', issuer: 's' });
  log.append({ digest: 'd2', identity: 'i', issuer: 's' });
  assert.strictEqual(log.verifyChain().ok, true);
  assert.strictEqual(log.inclusionProof(0).included, true);
  assert.strictEqual(log.inclusionProof(9).included, false);
  assert.throws(() => log.append({ digest: 'd3' }), /identity/);
  log._entries[0].digest = 'substituted';
  assert.strictEqual(log.verifyChain().ok, false);
  assert.strictEqual(log.inclusionProof(1).included, false);
});

test('supply chain: cosign-shaped image signing binds an identity to an image digest', () => {
  const sc = new SupplyChainAttestation({ clock: () => 1_000_000 });
  sc.signImage({ image: 'njtip/app', imageDigest: 'sha256:img-1', identity: IDENTITY, issuer: ISSUER });
  assert.strictEqual(sc.verifyImage('sha256:img-1', { expectedIdentity: IDENTITY }).valid, true);
  assert.strictEqual(sc.verifyImage('sha256:img-1', { expectedIdentity: 'someone-else' }).valid, false);
  assert.strictEqual(sc.verifyImage('sha256:never-signed').valid, false);
});

test('supply chain: an unknown license is forbidden, not tolerated', () => {
  assert.ok(!LICENSE_POLICY.allowed.includes('UNKNOWN'));
  assert.strictEqual(licenseVerdict(undefined).verdict, 'forbidden');
  assert.strictEqual(licenseVerdict('MIT').verdict, 'allowed');
  assert.strictEqual(licenseVerdict('AGPL-3.0').verdict, 'forbidden');
  assert.strictEqual(licenseVerdict('MPL-2.0').verdict, 'review-required');
});

test('supply chain: dependency risk is derived from facts, and package substitution is caught', () => {
  const now = 10_000_000_000;
  const sc = new SupplyChainAttestation({ clock: () => now });
  const risky = sc.dependencyRisk({ dependencies: [{ name: 'abandoned', supplier: 'npm', license: 'AGPL-3.0', knownVulnerabilities: 2, lastPublishedAt: now - 900 * 24 * 3600_000, depth: 5 }], approvedSuppliers: ['internal'], now });
  assert.strictEqual(risky.acceptable, false);
  assert.strictEqual(risky.dependencies[0].band, 'critical');
  const clean = sc.dependencyRisk({ dependencies: [{ name: 'lib', supplier: 'internal', license: 'MIT', digest: 'd', knownVulnerabilities: 0, lastPublishedAt: now, depth: 1 }], approvedSuppliers: ['internal'], now });
  assert.strictEqual(clean.dependencies[0].band, 'low');
  assert.strictEqual(sc.dependencyRisk({ dependencies: [] }).worstScore, 0);

  assert.strictEqual(sc.packageIntegrity({ locked: [{ name: 'a', digest: 'd1' }], fetched: [{ name: 'a', digest: 'd1' }] }).intact, true);
  assert.strictEqual(sc.packageIntegrity({ locked: [{ name: 'a', digest: 'd1' }], fetched: [{ name: 'a', digest: 'd2' }] }).intact, false);
  assert.strictEqual(sc.packageIntegrity({ locked: [], fetched: [{ name: 'smuggled', digest: 'd' }] }).intact, false);
});

test('supply chain: deployment fails for an untrusted artifact', () => {
  const now = 1_000_000;
  const sc = new SupplyChainAttestation({ clock: () => now });
  sc.buildProvenance({ artifact: 'njtip-app', artifactDigest: 'a1', sourceRef: 'git+njtip', sourceDigest: 'src' });
  const bundle = sc.keylessSign({ digest: 'a1', identity: IDENTITY, issuer: ISSUER });
  const inputs = {
    artifact: 'njtip-app', artifactDigest: 'a1', sbom: { runtime: 'node', dependencies: [], devDependencies: [], builtinsUsed: [] },
    dependencies: [], signedContainer: true, bundle, expectedIdentity: IDENTITY, expectedIssuer: ISSUER,
    reproducible: true, locked: [], fetched: [], now,
  };
  const ok = sc.verifyRelease(inputs);
  assert.strictEqual(ok.verified, true, ok.failed.join(', '));
  assert.ok(ok.trust.score >= TRUST_THRESHOLD);

  const blocked = sc.verifyRelease({
    ...inputs,
    dependencies: [{ name: 'abandoned', supplier: 'npm', license: 'AGPL-3.0', knownVulnerabilities: 3 }],
    locked: [{ name: 'abandoned', digest: 'd1' }], fetched: [{ name: 'abandoned', digest: 'SUBSTITUTED' }],
  });
  assert.strictEqual(blocked.verified, false);
  for (const c of ['dependency-risk', 'license-compliance', 'package-integrity', 'artifact-trust-score']) {
    assert.ok(blocked.failed.includes(c), `missing failing check: ${c}`);
  }
  assert.strictEqual(blocked.failClosed, true);
  assert.strictEqual(blocked.authorizes, false);
  assert.match(blocked.note, /not deployable/);
});

test('supply chain: a valid signature over a different artifact does not trust this one', () => {
  const now = 1_000_000;
  const sc = new SupplyChainAttestation({ clock: () => now });
  sc.buildProvenance({ artifact: 'njtip-app', artifactDigest: 'a1', sourceRef: 'git+njtip', sourceDigest: 'src' });
  const otherBundle = sc.keylessSign({ digest: 'some-other-artifact', identity: IDENTITY, issuer: ISSUER });
  const t = sc.artifactTrustScore({ artifactDigest: 'a1', bundle: otherBundle, expectedIdentity: IDENTITY, expectedIssuer: ISSUER, now });
  assert.ok(t.failing.includes('keyless-signature'));
  assert.strictEqual(t.trusted, false);
});

// --- Part 9: comprehensive AI governance --------------------------------------------------------

test('AI: a prompt owner cannot approve their own prompt', () => {
  const ai = new AiLifecycle({ clock: () => 1000 });
  ai.register('prompt', 'p', { owner: 'analytics', purpose: 'case-summarisation', riskClass: 'limited', text: 'summarise' });
  ai.submitForApproval('prompt', 'p', { by: 'analytics', rationale: 'reviewed' });
  assert.ok(ai.pendingApprovals().some((x) => x.id === 'p'));
  assert.throws(() => ai.approve('prompt', 'p', { by: 'analytics', rationale: 'fine' }), /may not approve it/);
  assert.throws(() => ai.reject('prompt', 'p', { by: 'analytics', rationale: 'x' }), /may not rule on its own/);
  ai.approve('prompt', 'p', { by: 'AI Governance Board', rationale: 'anonymity-safe' });
  assert.strictEqual(ai.isApproved('prompt', 'p').approved, true);
});

test('AI: a prompt edited after submission is not the prompt that was reviewed', () => {
  const ai = new AiLifecycle({ clock: () => 1000 });
  ai.register('prompt', 'p', { owner: 'analytics', purpose: 'case-summarisation', riskClass: 'limited', text: 'v1' });
  ai.submitForApproval('prompt', 'p', { by: 'analytics', rationale: 'reviewed' });
  ai._artifacts.get('prompt:p').current.textDigest = 'edited';
  assert.throws(() => ai.approve('prompt', 'p', { by: 'AI Governance Board', rationale: 'r' }), /did not see this version/);
});

test('AI: training data must be registered, traced, approved and measured', () => {
  const ai = new AiLifecycle({ clock: () => 1000 });
  ai.register('dataset', 'ds', { owner: 'analytics', purpose: 'model-training', riskClass: 'limited', fields: ['category'] });
  assert.strictEqual(ai.datasetLineage('ds').traced, false);
  assert.throws(() => ai.recordDatasetLineage('ds', { by: 'Steward', sources: [], lawfulBasis: 'b' }), /at least one source/);
  assert.throws(() => ai.recordDatasetLineage('ds', { by: 'Steward', sources: ['s'] }), /lawful basis/);
  assert.throws(() => ai.recordDatasetLineage('ds', { by: 'Steward', sources: ['s'], lawfulBasis: 'b', syntheticOnly: false }), /synthetic data only/);
  ai.recordDatasetLineage('ds', { by: 'Steward', sources: ['synthetic-generator@seed-42'], lawfulBasis: 'no personal data is processed' });
  assert.strictEqual(ai.datasetLineage('ds').traced, true);

  assert.strictEqual(ai.datasetQuality('ds').acceptable, false, 'unmeasured is not clean');
  ai.observeDatasetQuality('ds', { completeness: 1 });
  assert.strictEqual(ai.datasetQuality('ds').acceptable, false, 'partially measured is not measured');
  ai.observeDatasetQuality('ds', Object.fromEntries(DATASET_QUALITY_DIMENSIONS.map((d) => [d, 0.95])));
  assert.strictEqual(ai.datasetQuality('ds').acceptable, true);

  ai.register('model', 'm', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high', trainingData: ['ds'] });
  assert.strictEqual(ai.trainingDataAcceptable('m').acceptable, false, 'the dataset is not yet approved');
  ai.approve('dataset', 'ds', { by: 'Data Governance Board', rationale: 'synthetic and traced' });
  assert.strictEqual(ai.trainingDataAcceptable('m').acceptable, true);

  ai.register('model', 'ghost', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high', trainingData: ['unregistered'] });
  assert.strictEqual(ai.trainingDataAcceptable('ghost').acceptable, false);
});

test('AI: a below-floor confidence withholds the output rather than caveating it', () => {
  const ai = new AiLifecycle({ clock: () => 1000 });
  ai.register('model', 'm', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high' });
  ai.approve('model', 'm', { by: 'AI Governance Board', rationale: 'advisory only' });
  assert.ok(RISK_CLASSES.high.minConfidence > RISK_CLASSES.limited.minConfidence);
  assert.throws(() => ai.infer({ model: 'm', output: 'x', explanation: 'e', requestedBy: 'inv' }), /requires a confidence score/);
  assert.throws(() => ai.infer({ model: 'm', output: 'x', explanation: 'e', confidence: 0.5, requestedBy: 'inv' }), /withheld/);
  const inf = ai.infer({ model: 'm', output: 'high', explanation: 'e', confidence: 0.85, requestedBy: 'inv' });
  assert.strictEqual(inf.authorizes, false);
});

test('AI: an under-sampled hallucination rate does not read as safe', () => {
  const ai = new AiLifecycle({ clock: () => 1000 });
  const thin = ai.hallucinationReport('m');
  assert.strictEqual(thin.rate, null);
  assert.strictEqual(thin.withinThreshold, null);
  for (let i = 0; i < 40; i++) ai.recordGrounding('m', { grounded: true });
  assert.strictEqual(ai.hallucinationReport('m').withinThreshold, true);
  for (let i = 0; i < 10; i++) ai.recordGrounding('m', { grounded: false, reason: 'cited no source' });
  const bad = ai.hallucinationReport('m');
  assert.strictEqual(bad.withinThreshold, false);
  assert.notStrictEqual(bad.severity, 'ok');
  assert.ok(bad.examples.length > 0);
  assert.throws(() => ai.recordGrounding('m', { grounded: 'probably' }), /boolean/);
});

test('AI: drift detection is deterministic, append-only and bands by PSI', () => {
  const ai = new AiLifecycle({ clock: () => 1000 });
  assert.strictEqual(ai.driftReport('m').band, 'insufficient-data');
  ai.observeDistribution('m', { period: 0, distribution: { police: 50, courts: 30, prison: 20 } });
  ai.observeDistribution('m', { period: 1, distribution: { police: 50, courts: 30, prison: 20 } });
  assert.strictEqual(ai.driftReport('m').drifted, false);
  ai.observeDistribution('m', { period: 2, distribution: { police: 5, courts: 15, prison: 80 } });
  const d = ai.driftReport('m');
  assert.strictEqual(d.band, 'significant');
  assert.ok(d.action);
  assert.deepStrictEqual(ai.driftReport('m'), d);
  assert.throws(() => ai.observeDistribution('m', { period: 2, distribution: { police: 1 } }), /append-only/);
  assert.throws(() => ai.observeDistribution('m', { period: 9, distribution: {} }), /some mass/);
});

test('AI: monitoring can require re-approval but never grant one', () => {
  const ai = new AiLifecycle({ clock: () => 1000 });
  ai.register('model', 'm', { owner: 'analytics', purpose: 'case-prioritisation', riskClass: 'high' });
  ai.approve('model', 'm', { by: 'AI Governance Board', rationale: 'r' });
  for (let i = 0; i < 40; i++) ai.recordGrounding('m', { grounded: i % 2 === 0 });
  ai.observeDistribution('m', { period: 0, distribution: { a: 90, b: 10 } });
  ai.observeDistribution('m', { period: 1, distribution: { a: 10, b: 90 } });
  const p = ai.monitoringPosture('m');
  assert.strictEqual(p.healthy, false);
  assert.strictEqual(p.requiresReApproval, true);
  assert.strictEqual(p.authorizes, false);
  assert.strictEqual(p.advisoryOnly, true);
  assert.ok(p.concerns.length >= 2);
});
