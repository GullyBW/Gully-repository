'use strict';
// Phase 10, Parts 7, 8 & 10 — enterprise data governance, secure software supply chain,
// and multi-region operational resilience.
const test = require('node:test');
const assert = require('node:assert');
const { DataGovernance, seedPlatformDatasets, RETENTION_POLICIES } = require('../src/fabric/data-governance');
const { SupplyChainAttestation, sourceDigest, CLAIMED_LEVEL } = require('../src/supplychain/slsa');
const mr = require('../src/twin2/multi-region');
const { sbom } = require('../scripts/devsecops');

const T0 = 1_000_000;
const FUTURE = T0 + 9e12;
const dg = () => seedPlatformDatasets(new DataGovernance({ clock: () => T0 }));

// --- Part 7: data governance ----------------------------------------------------------------

test('data governance: every governed record answers all five lifecycle stages', () => {
  const g = dg();
  assert.deepStrictEqual(g.validate().violations, []);
  for (const id of g.datasets()) {
    const t = g.traceRecord(id);
    assert.strictEqual(t.complete, true, id);
    assert.ok(t.origin, `${id} origin`);
    assert.ok(Array.isArray(t.transformations), `${id} transformations`);
    assert.ok(Array.isArray(t.consumers), `${id} consumers`);
    assert.ok(t.retention.basis, `${id} retention basis`);
    assert.ok(t.deletion.plan || t.deletion.deleted, `${id} deletion`);
  }
});

test('data governance: registration requires retention, purpose and no identity fields', () => {
  const g = dg();
  assert.throws(() => g.register('a', { origin: 'o', retentionClass: 'nope', purpose: 'p' }), /retention class/);
  assert.throws(() => g.register('b', { origin: 'o', retentionClass: 'telemetry' }), /purpose/);
  assert.throws(() => g.register('c', { origin: 'o', retentionClass: 'telemetry', purpose: 'p', fields: ['email'] }), /identity fields/);
});

test('data governance: purpose limitation binds consumers across domains', () => {
  const g = dg();
  assert.throws(() => g.addConsumer('case-records', { consumer: 'marketing', purpose: 'outreach' }), /purpose limitation/);
  assert.ok(g.addConsumer('case-records', { consumer: 'appeals-service', purpose: 'investigation-of-reported-conduct' }).consumers >= 2);
});

test('data governance: cross-domain lineage is computed from recorded transformations', () => {
  const g = dg();
  const lineage = g.lineageGraph();
  assert.ok(lineage.edges.some((e) => e.from === 'case-records' && e.to === 'oversight-aggregates'));
  assert.ok(lineage.crossDomainEdges.length >= 1, 'Justice → Insight is a cross-domain edge');
  assert.ok(lineage.nodes.every((n) => n.domain));
});

test('data governance: a legal hold beats retention and deletion is fail-closed', () => {
  const g = dg();
  const hold = g.placeLegalHold('case-records', { matter: 'M-1', by: 'Attorney General Chambers', rationale: 'active litigation' });
  assert.throws(() => g.delete('case-records', { by: 'Records Steward', rationale: 'retention elapsed', now: FUTURE }), /legal hold/);
  assert.throws(() => g.placeLegalHold('case-records', { matter: 'M-2', by: 'x' }), /rationale/);
  g.releaseLegalHold(hold.id, { by: 'Attorney General Chambers', rationale: 'matter closed' });
  assert.throws(() => g.delete('audit-chain', { by: 'x', rationale: 'y', now: T0 + 1 }), /retention period has not elapsed/);
  assert.strictEqual(g.delete('case-records', { by: 'Records Steward', rationale: 'retention elapsed', now: FUTURE }).deleted, true);
});

test('data governance: permanently retained records can never be destroyed', () => {
  const g = dg();
  assert.strictEqual(RETENTION_POLICIES['governance-decision'].retentionDays, -1);
  assert.throws(() => g.delete('governance-decisions', { by: 'x', rationale: 'y', now: FUTURE }), /retained permanently/);
  assert.match(g.traceRecord('governance-decisions').deletion.plan, /permanent/);
});

test('data governance: consent lifecycle is role-coded, purpose-bound and withdrawable', () => {
  const g = dg();
  assert.throws(() => g.recordConsent('C', { subjectRole: 'email', purpose: 'p', grantedBy: 'x' }), /refuse identity fields/);
  g.recordConsent('C1', { subjectRole: 'partner-agency-analyst', purpose: 'joint-analysis', grantedBy: 'Data Steward' });
  assert.strictEqual(g.consentValid('C1', { purpose: 'joint-analysis' }).valid, true);
  assert.strictEqual(g.consentValid('C1', { purpose: 'anything-else' }).valid, false);
  g.withdrawConsent('C1', { by: 'subject' });
  assert.strictEqual(g.consentValid('C1', { purpose: 'joint-analysis' }).valid, false);
});

test('data governance: quality, reference and master data are governed', () => {
  const g = dg();
  g.observeQuality('oversight-aggregates', { completeness: 1, validity: 0.99, timeliness: 0.8 });
  const q = g.qualityScore('oversight-aggregates', { threshold: 0.9 });
  assert.strictEqual(q.measured, true);
  assert.deepStrictEqual(q.failing, ['timeliness']);
  assert.strictEqual(q.meets, false);
  assert.strictEqual(g.qualityScore('platform-telemetry').measured, false);
  assert.throws(() => g.observeQuality('oversight-aggregates', { vibes: 1 }), /unknown quality dimension/);
  assert.strictEqual(g.validateReferenceValue('case-category', 'police').valid, true);
  assert.strictEqual(g.validateReferenceValue('case-category', 'invented').valid, false);
  for (const m of g.masterData()) { assert.ok(m.authoritativeSource, m.id); assert.ok(m.steward, m.id); }
});

// --- Part 8: supply chain ----------------------------------------------------------------------

test('supply chain: provenance is SLSA-shaped, signed and verifiable', () => {
  const sc = new SupplyChainAttestation({ clock: () => 0 });
  assert.throws(() => sc.buildProvenance({ artifact: 'a', artifactDigest: 'd' }), /source/);
  const prov = sc.buildProvenance({ artifact: 'njtip-app', artifactDigest: 'abc', sourceRef: 'git+njtip', sourceDigest: sourceDigest() });
  assert.strictEqual(prov.statement._type, 'https://in-toto.io/Statement/v1');
  assert.strictEqual(prov.statement.predicateType, 'https://slsa.dev/provenance/v1');
  assert.ok(prov.signature);
  assert.strictEqual(sc.verify(prov.id).valid, true);
  assert.strictEqual(sc.verifyArtifact('abc').valid, true);
});

test('supply chain: a tampered attestation and an unattested artifact both fail', () => {
  const sc = new SupplyChainAttestation({ clock: () => 0 });
  const prov = sc.buildProvenance({ artifact: 'njtip-app', artifactDigest: 'abc', sourceRef: 'git+njtip', sourceDigest: 'src' });
  sc._attestations.get(prov.id).statement.predicate.builder.id = 'attacker';
  const verdict = sc.verify(prov.id);
  assert.strictEqual(verdict.valid, false);
  assert.match(verdict.reason, /altered/);
  assert.match(sc.verifyArtifact('never-built').reason, /not deployable/);
});

test('supply chain: release verification is fail-closed and names each failed check', () => {
  const sc = new SupplyChainAttestation({ clock: () => 0 });
  sc.buildProvenance({ artifact: 'njtip-app', artifactDigest: 'abc', sourceRef: 'git+njtip', sourceDigest: 'src' });
  const blocked = sc.verifyRelease({ artifact: 'njtip-app', artifactDigest: 'abc', sbom: sbom(), dependencies: [] });
  assert.strictEqual(blocked.verified, false);
  assert.ok(blocked.failed.includes('container-signature'));
  assert.strictEqual(blocked.failClosed, true);
  assert.strictEqual(blocked.authorizes, false);
  // Phase 11 raised the bar for a verified release: a keyless signature in the transparency log,
  // a reproducible build and a lockfile that matches are now part of "fully attested".
  const bundle = sc.keylessSign({ digest: 'abc', identity: 'https://github.com/gov/njtip/.github/workflows/release.yml@refs/tags/v1', issuer: 'https://token.actions.githubusercontent.com' });
  const ok = sc.verifyRelease({
    artifact: 'njtip-app', artifactDigest: 'abc', sbom: sbom(), dependencies: [], signedContainer: true,
    bundle, expectedIdentity: bundle.certificate.identity, expectedIssuer: bundle.certificate.issuer,
    reproducible: true, locked: [], fetched: [],
  });
  assert.strictEqual(ok.verified, true, 'failed: ' + ok.failed.join(', '));
  assert.strictEqual(ok.trust.trusted, true);
  const unattested = sc.verifyRelease({ artifact: 'other', artifactDigest: 'zzz', sbom: sbom(), signedContainer: true });
  assert.ok(unattested.failed.includes('build-provenance'));
});

test('supply chain: dependencies must be pinned, and the build is reproducible', () => {
  const sc = new SupplyChainAttestation({ clock: () => 0 });
  assert.strictEqual(sc.verifyDependencies({ dependencies: [{ name: 'x', supplier: 's' }] }).verified, false);
  assert.strictEqual(sc.verifyDependencies({ dependencies: [{ name: 'x', supplier: 's', digest: 'd' }] }).verified, true);
  assert.strictEqual(sc.verifyDependencies({ dependencies: [{ name: 'x', supplier: 'rogue', digest: 'd' }], approvedSuppliers: ['s'] }).verified, false);
  assert.strictEqual(sc.verifyReproducible({ buildFn: () => sourceDigest() }).reproducible, true);
  let n = 0;
  assert.strictEqual(sc.verifyReproducible({ buildFn: () => ++n }).reproducible, false, 'a non-deterministic build must be detected');
});

test('supply chain: the SLSA claim matches its evidence and states its gaps', () => {
  const posture = new SupplyChainAttestation().slsaPosture();
  assert.strictEqual(posture.claimedLevel, CLAIMED_LEVEL);
  for (const l of posture.levels) if (l.level <= CLAIMED_LEVEL) assert.strictEqual(l.met, true, `L${l.level}`);
  assert.ok(posture.honestGaps.length >= 1);
  for (const g of posture.honestGaps) assert.ok(g.why.length > 30, `L${g.level} needs an explanation`);
});

// --- Part 10: multi-region -------------------------------------------------------------------------

test('multi-region: every declared failover scenario behaves as designed', () => {
  assert.deepStrictEqual(mr.validate().violations, []);
  const sims = mr.simulateAll();
  assert.strictEqual(sims.allMatch, true, JSON.stringify(sims.mismatched));
  assert.strictEqual(sims.authorizes, false);
});

test('multi-region: losing quorum degrades to read-only, never to divergent writes', () => {
  const one = mr.failover({ failed: ['bw-south'] });
  assert.strictEqual(one.mode, 'read-write');
  const two = mr.failover({ failed: ['bw-central', 'bw-south'] });
  assert.strictEqual(two.mode, 'read-only');
  assert.strictEqual(two.acceptsWrites, false);
  assert.strictEqual(two.servesTraffic, true);
  const all = mr.failover({ failed: ['bw-central', 'bw-south', 'bw-north'] });
  assert.strictEqual(all.mode, 'unavailable');
});

test('multi-region: split brain is prevented and the writable partition is fenced', () => {
  const safe = mr.splitBrainCheck({ partitions: [{ name: 'majority', regions: ['bw-central', 'bw-south'] }, { name: 'minority', regions: ['bw-north'] }] });
  assert.strictEqual(safe.splitBrain, false);
  assert.strictEqual(safe.writablePartitions, 1);
  assert.ok(safe.fencingToken > 0);
  const none = mr.splitBrainCheck({ partitions: [{ name: 'a', regions: ['bw-central'] }, { name: 'b', regions: ['bw-north'] }] });
  assert.strictEqual(none.writablePartitions, 0);
  assert.strictEqual(none.safe, true);
  assert.match(none.outcome, /READ-ONLY/);
});

test('multi-region: routing refuses an illegal residency rather than degrading to it', () => {
  const refused = mr.route({ classification: 'restricted', healthy: ['za-north'] });
  assert.strictEqual(refused.routed, false);
  assert.strictEqual(refused.failClosed, true);
  const routed = mr.route({ classification: 'restricted', healthy: ['bw-south', 'za-north'] });
  assert.strictEqual(routed.region, 'bw-south');
  assert.ok(routed.refusedRegions.includes('za-north'));
  assert.strictEqual(mr.route({ classification: 'secret', healthy: ['bw-north'] }).routed, false, 'bw-north is not cleared for secret');
  assert.strictEqual(mr.route({ classification: 'public', healthy: ['za-north'] }).routed, true);
});

test('multi-region: backup verification checks content, count and residency', () => {
  const base = { classification: 'restricted', sourceDigest: 'd', restoredDigest: 'd', recordsIn: 5, recordsOut: 5 };
  assert.strictEqual(mr.verifyBackupRecovery({ ...base, restoredRegion: 'bw-south' }).verified, true);
  assert.strictEqual(mr.verifyBackupRecovery({ ...base, restoredRegion: 'za-north' }).verified, false);
  assert.strictEqual(mr.verifyBackupRecovery({ ...base, restoredDigest: 'x', restoredRegion: 'bw-south' }).verified, false);
  assert.strictEqual(mr.verifyBackupRecovery({ ...base, recordsOut: 4, restoredRegion: 'bw-south' }).verified, false);
});

test('multi-region: cross-region consistency reports lag and safe read replicas', () => {
  const c = mr.consistencyCheck({ committedSequence: 100, replicas: { 'bw-central': 100, 'bw-south': 100, 'bw-north': 97 } });
  assert.strictEqual(c.consistent, false);
  assert.strictEqual(c.maxLag, 3);
  assert.deepStrictEqual(c.stale, ['bw-north']);
  assert.deepStrictEqual(c.readsSafeFrom, ['bw-central', 'bw-south']);
});
