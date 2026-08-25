'use strict';
// Phase 13, Parts 14, 16 & 17 — evidence quality, architecture drift prevention, governance analytics.
const test = require('node:test');
const assert = require('node:assert');
const ec = require('../src/assurance/evidence-confidence');
const dp = require('../src/architecture/drift-prevention');
const asm = require('../src/architecture/assumptions');
const contextMap = require('../src/architecture/context-map');
const ownership = require('../src/governance/ownership');

const controls = () => [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];

// --- Part 14: evidence quality ---------------------------------------------------------------------

function populated() {
  let clock = 0;
  const reg = new ec.EvidenceRegister({ clock: () => clock });
  reg.record({ id: 'check', source: 'executable-check', completeness: 1, verifiedAt: 0, now: 0 });
  reg.record({ id: 'attestation', source: 'human-attestation', completeness: 1, verifiedAt: 0, now: 0 });
  reg.record({ id: 'sibling', source: 'executable-check', completeness: 1, verifiedAt: 0, now: 0 });
  clock = 3600_000;
  reg.record({ id: 'check', source: 'executable-check', completeness: 1, verifiedAt: clock, now: clock });
  return { reg, now: clock };
}

test('all eight quality dimensions are declared, each saying what weak means', () => {
  for (const required of ['completeness', 'freshness', 'provenance', 'integrity', 'reproducibility', 'corroboration', 'independence', 'historical-consistency']) {
    assert.ok(ec.QUALITY_DIMENSIONS[required], required);
    assert.ok(ec.QUALITY_DIMENSIONS[required].description, required);
    assert.ok(ec.QUALITY_DIMENSIONS[required].weakMeans, required);
  }
});

test('agreement from the same source kind is not corroboration', () => {
  const { reg, now } = populated();
  const same = ec.evidenceQuality(reg, 'check', { corroborators: ['sibling'], now });
  assert.strictEqual(same.independentlyCorroborated, false);
  assert.strictEqual(same.dimensions.find((d) => d.dimension === 'independence').score, 0);
  assert.match(same.dimensions.find((d) => d.dimension === 'independence').basis, /agreement by construction/);
  const cross = ec.evidenceQuality(reg, 'check', { corroborators: ['attestation'], now });
  assert.strictEqual(cross.independentlyCorroborated, true);
  assert.ok(cross.dimensions.find((d) => d.dimension === 'independence').score > 0);
});

test('quality is the weakest dimension, never the mean, and names which', () => {
  const { reg, now } = populated();
  const q = ec.evidenceQuality(reg, 'check', { corroborators: ['attestation'], now });
  assert.strictEqual(q.quality, Math.min(...q.dimensions.map((d) => d.score)));
  assert.ok(q.weakestDimension);
  assert.ok(q.note.includes(q.weakestDimension));
  assert.strictEqual(q.replacesAuthorization, false);
});

test('reproducibility distinguishes a check that re-runs from a person who asserted', () => {
  const { reg, now } = populated();
  assert.strictEqual(ec.evidenceQuality(reg, 'check', { now }).dimensions.find((d) => d.dimension === 'reproducibility').score, 1);
  assert.strictEqual(ec.evidenceQuality(reg, 'attestation', { now }).dimensions.find((d) => d.dimension === 'reproducibility').score, 0);
  // An explicit check overrides the inference in both directions.
  assert.strictEqual(ec.evidenceQuality(reg, 'attestation', { now, reproducible: true }).dimensions.find((d) => d.dimension === 'reproducibility').score, 1);
  assert.strictEqual(ec.evidenceQuality(reg, 'check', { now, reproducible: false }).dimensions.find((d) => d.dimension === 'reproducibility').score, 0);
});

test('one verification is no history to be consistent with', () => {
  const { reg, now } = populated();
  assert.strictEqual(ec.evidenceQuality(reg, 'sibling', { now }).dimensions.find((d) => d.dimension === 'historical-consistency').score, 0);
  assert.ok(ec.evidenceQuality(reg, 'check', { now }).dimensions.find((d) => d.dimension === 'historical-consistency').score > 0);
});

test('evidence that was never recorded is no evidence, not poor evidence', () => {
  const { reg } = populated();
  const q = ec.evidenceQuality(reg, 'never-recorded');
  assert.strictEqual(q.known, false);
  assert.match(q.reason, /no evidence at all/);
});

test('the dashboard aggregates to the weakest item and never replaces authorization', () => {
  const { reg, now } = populated();
  const d = ec.evidenceQualityDashboard(reg, { now, corroboration: { check: ['attestation'] } });
  assert.strictEqual(d.quality, Math.min(...d.evidence.map((e) => e.quality)));
  assert.ok(d.weakestDimension);
  assert.strictEqual(d.replacesAuthorization, false);
  assert.strictEqual(d.authorizes, false);
  assert.strictEqual(d.contributesToReadiness, true);
  assert.match(d.note, /never replaces human authorization/);
  assert.ok(d.uncorroborated.length > 0);
});

// --- Part 16: architecture drift -------------------------------------------------------------------

test('every drift kind is checked in both directions', () => {
  for (const required of ['module', 'coupling', 'api', 'control', 'ownership', 'assumption']) {
    assert.ok(dp.DRIFT_KINDS[required], required);
    assert.ok(dp.DRIFT_KINDS[required].undocumented, required);
    assert.ok(dp.DRIFT_KINDS[required].unrealised, required);
  }
});

test('there is no structural drift', () => {
  const assumptions = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
  const d = dp.detect({ controls: controls(), assumptions });
  assert.deepStrictEqual(d.structural.map((f) => `${f.kind}/${f.direction}: ${f.subject}`), []);
  assert.strictEqual(d.clean, true);
  assert.strictEqual(d.authorizes, false);
});

test('source coupling is reported as its own kind rather than as undeclared dependency', () => {
  // Conflating the two produced 121 findings, almost all noise. `dependsOn` is a curated DDD
  // relationship; a require() of a shared hash function is not one.
  const d = dp.detect({ controls: controls() });
  assert.ok(d.couplingCount > 0);
  assert.ok(d.coupling.every((f) => f.kind === 'coupling'));
  assert.ok(!d.structural.some((f) => f.kind === 'coupling'));
  assert.match(dp.DRIFT_KINDS.coupling.undocumented, /different things/);
});

test('the scanners are actually finding things, so "clean" cannot mean "broken"', () => {
  assert.ok(dp.sourceFiles().length > 100);
  assert.ok(Object.keys(dp.actualDependencies()).length > 5);
  assert.deepStrictEqual(dp.moduleOwner('src/nowhere/imaginary.js'), []);
  assert.strictEqual(dp.moduleOwner('src/server.js').length, 1);
});

test('every bounded context has an accountability record, and vice versa', () => {
  for (const id of contextMap.ids()) assert.ok(ownership.subsystems().includes(id), id);
  for (const id of ownership.subsystems()) assert.ok(contextMap.ids().includes(id), id);
});

test('an assumption naming a context that does not exist is detected as unrealised drift', () => {
  const registry = new asm.AssumptionRegistry({ clock: () => 0 });
  registry.register('GHOST', {
    statement: 'A statement about a context that is gone.', rationale: 'Recorded before the context was renamed.',
    contexts: ['ministry-of-typos'], owner: 'ARB', reviewCadenceDays: 90,
    expiresAt: 365 * 24 * 3600_000, verificationMethod: 'human-attestation',
  });
  const d = dp.detect({ assumptions: registry });
  assert.ok(d.findings.some((f) => f.kind === 'assumption' && f.direction === 'unrealised' && f.subject === 'GHOST'));
  assert.strictEqual(d.clean, false);
});

// --- Part 17: governance analytics -----------------------------------------------------------------

test('governance analytics forecasts bottlenecks from the registers', () => {
  const assumptions = asm.seedPlatformAssumptions(new asm.AssumptionRegistry({ clock: () => 0 }));
  const a = dp.governanceAnalytics({ assumptions, controls: controls(), now: 0 });
  assert.ok(a.ownershipLoad.length > 0);
  assert.strictEqual(a.auditReadiness, 1);
  assert.ok(a.bottlenecks.length > 0);
  assert.ok(a.forecast);
  assert.strictEqual(a.authorizes, false);
});

test('ownership load accounts for every subsystem and role pair', () => {
  const a = dp.governanceAnalytics({ controls: controls(), now: 0 });
  const total = a.ownershipLoad.reduce((sum, l) => sum + l.roles, 0);
  assert.strictEqual(total, ownership.subsystems().length * ownership.DEPUTY_ROLES.length);
  // An authority carrying a quarter of the estate is a bottleneck whether or not anything has jammed.
  for (const l of a.ownershipLoad) assert.ok(l.share >= 0 && l.share <= 1);
});

test('unmeasured capacity is itself a bottleneck', () => {
  const a = dp.governanceAnalytics({ controls: controls(), now: 0 });
  assert.ok(a.bottlenecks.some((b) => b.kind === 'unmeasured-capacity'));
  assert.match(a.bottlenecks.find((b) => b.kind === 'unmeasured-capacity').detail, /unknown is not capacity/);
});

test('audit readiness falls when controls fail', () => {
  const half = controls().map((c, i) => ({ ...c, pass: i % 2 === 0 }));
  const a = dp.governanceAnalytics({ controls: half, now: 0 });
  assert.ok(a.auditReadiness < 1);
  assert.strictEqual(dp.governanceAnalytics({ controls: [], now: 0 }).auditReadiness, null);
});
