'use strict';
// Phase 15, Parts 2, 5 & 9 — the legal authority registry, dependency intelligence and
// multi-perspective risk prioritisation.
const test = require('node:test');
const assert = require('node:assert');
const la = require('../src/legislation/legal-authority');
const ir = require('../src/governance/institutional-resilience');

const DAY = 24 * 3600_000;
const controlsAll = () => [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];
const GOOD = {
  kind: 'legislation', instrument: 'an instrument recorded by the institution',
  approvingOrganization: 'Attorney General Chambers', reviewEveryDays: 365,
  expiresAt: 1000 * DAY, evidence: ['APP-FIT-LEGISLATIVE-IMPACT'],
  scope: 'investigate reports to an outcome', declaredBy: 'Legal Informatics Team',
};

// --- Part 5: legal authority ------------------------------------------------------------------------

test('five authority kinds, each saying how it can be withdrawn', () => {
  for (const required of ['constitutional', 'legislation', 'delegated-authority', 'regulation', 'policy']) {
    assert.ok(la.AUTHORITY_KINDS[required], required);
  }
  for (const [id, k] of Object.entries(la.AUTHORITY_KINDS)) {
    assert.ok(k.withdrawnBy, id);
    assert.ok(k.means.length > 25, id);
  }
  assert.ok(la.AUTHORITY_KINDS.constitutional.rank < la.AUTHORITY_KINDS.policy.rank);
});

test('unknown, expired and withdrawn are three different states and all of them block', () => {
  for (const s of ['unknown', 'expired', 'withdrawn', 'overdue', 'declared']) {
    assert.strictEqual(la.AUTHORITY_STATES[s].authorized, false, s);
    assert.strictEqual(la.AUTHORITY_STATES[s].blocksReadiness, true, s);
  }
  assert.strictEqual(la.AUTHORITY_STATES.reviewed.authorized, true);
  // They must not be described identically — three different people have to act.
  const means = ['unknown', 'expired', 'withdrawn'].map((s) => la.AUTHORITY_STATES[s].means);
  assert.strictEqual(new Set(means).size, 3);
});

test('an incomplete declaration is refused — a partial legal claim reads as a complete one', () => {
  const reg = new la.LegalAuthorityRegistry({ clock: () => 0 });
  for (const field of Object.keys(la.AUTHORITY_FIELDS)) {
    const partial = { ...GOOD };
    delete partial[field];
    assert.throws(() => reg.declare('case-investigation', partial), undefined, `missing ${field} was accepted`);
  }
  assert.throws(() => reg.declare('case-investigation', { ...GOOD, declaredBy: null }), (e) => e.failClosed === true);
  // Delegated authority with no source cannot be traced to a legal basis.
  assert.throws(() => reg.declare('case-investigation', { ...GOOD, kind: 'delegated-authority' }), (e) => e.failClosed === true);
  assert.ok(reg.declare('case-investigation', { ...GOOD, kind: 'delegated-authority', delegatedFrom: 'the Attorney General' }));
});

test('review is by the approving organization and by nobody else', () => {
  const reg = new la.LegalAuthorityRegistry({ clock: () => 0 });
  reg.declare('case-investigation', GOOD);
  assert.strictEqual(reg.state('case-investigation', { now: 0 }).state, 'declared');
  assert.strictEqual(reg.state('case-investigation', { now: 0 }).authorized, false);
  assert.throws(() => reg.review('case-investigation', { by: 'Platform Engineering' }), (e) => e.failClosed === true);
  reg.review('case-investigation', { by: 'Attorney General Chambers', at: 1 });
  const s = reg.state('case-investigation', { now: 2, controls: controlsAll() });
  assert.strictEqual(s.state, 'reviewed');
  assert.strictEqual(s.authorized, true);
});

test('a lapse, an expiry, a withdrawal and a failed review are each their own state', () => {
  const reg = new la.LegalAuthorityRegistry({ clock: () => 0 });
  reg.declare('case-investigation', GOOD);
  reg.review('case-investigation', { by: 'Attorney General Chambers', at: 1 });
  assert.strictEqual(reg.state('case-investigation', { now: 500 * DAY }).state, 'overdue');
  assert.strictEqual(reg.state('case-investigation', { now: 2000 * DAY }).state, 'expired');

  const w = new la.LegalAuthorityRegistry({ clock: () => 0 });
  w.declare('case-investigation', GOOD);
  w.review('case-investigation', { by: 'Attorney General Chambers', at: 1 });
  w.withdraw('case-investigation', { by: 'Attorney General Chambers', reason: 'repealed', at: 2 });
  assert.strictEqual(w.state('case-investigation', { now: 3 }).state, 'withdrawn');
  assert.throws(() => w.withdraw('case-investigation', { by: 'X' }), (e) => e.failClosed === true);

  const f = new la.LegalAuthorityRegistry({ clock: () => 0 });
  f.declare('case-investigation', GOOD);
  f.review('case-investigation', { by: 'Attorney General Chambers', at: 1, stillStands: false });
  assert.strictEqual(f.state('case-investigation', { now: 2 }).state, 'withdrawn');
});

test('the registry ships with no statutory claims, and unknown authority blocks readiness', () => {
  const empty = new la.LegalAuthorityRegistry({ clock: () => 0 });
  assert.deepStrictEqual(empty.declarations(), []);
  const r = empty.report({ now: 0, controls: controlsAll() });
  assert.strictEqual(r.count, Object.keys(ir.CRITICAL_CAPABILITIES).length);
  assert.strictEqual(r.blocksReadiness, true);
  assert.strictEqual(r.complete, false);
  assert.strictEqual(r.unknown.length, r.count);
  assert.ok(r.criticalGaps.length, 'constitutional capabilities with no recorded authority are the sharpest gap');
  assert.match(r.note, /no statutory claims/);
  assert.match(r.completenessBasis, /three different people/);
});

test('validation catches a declaration naming a body that is not in the accountability record', () => {
  const reg = new la.LegalAuthorityRegistry({ clock: () => 0 });
  reg.declare('case-investigation', GOOD);
  assert.strictEqual(reg.validate().valid, true);
  const wrong = new la.LegalAuthorityRegistry({ clock: () => 0 });
  wrong.declare('case-investigation', { ...GOOD, approvingOrganization: 'The Ministry of Magic' });
  assert.strictEqual(wrong.validate().valid, false);
});

// --- Part 2: dependency intelligence ----------------------------------------------------------------

test('ten standardized types, each saying how it fails and how fast it is noticed', () => {
  assert.strictEqual(Object.keys(ir.DEPENDENCY_TYPES).length, 10);
  for (const required of ['technical', 'operational', 'organizational', 'legal', 'contractual', 'informational', 'governance', 'infrastructure', 'communications', 'facilities']) {
    assert.ok(ir.DEPENDENCY_TYPES[required], required);
  }
  for (const [id, t] of Object.entries(ir.DEPENDENCY_TYPES)) {
    assert.ok(t.failsBy.length > 30, id);
    assert.ok(t.detectedIn, id);
  }
});

test('every kind carries exactly one type, and every type classifies something', () => {
  for (const kind of Object.keys(ir.DEPENDENCY_KINDS)) {
    const t = ir.typeOfKind(kind);
    assert.ok(t, kind);
    assert.ok(ir.DEPENDENCY_TYPES[t], `${kind} -> ${t}`);
  }
  const used = new Set(Object.keys(ir.DEPENDENCY_KINDS).map((k) => ir.typeOfKind(k)));
  for (const t of Object.keys(ir.DEPENDENCY_TYPES)) assert.ok(used.has(t), `type '${t}' classifies nothing`);
});

test('the intelligence report carries kind, category and type without three models', () => {
  const di = ir.dependencyIntelligence(ir.evaluate({ controls: controlsAll() }));
  assert.ok(di.count > 0);
  for (const d of di.dependencies) {
    assert.ok(d.kind && d.category && d.type, JSON.stringify(d));
  }
  assert.deepStrictEqual(di.unmappedKinds, []);
  assert.deepStrictEqual(di.blindSpots, []);
  assert.ok(di.weakestType.type);
  assert.strictEqual(di.authorizes, false);
});

test('impact propagates over declared structure only, and says it is a lower bound', () => {
  const controls = controlsAll();
  const technical = ir.dependencyImpact({ capability: 'anonymous-reporting', kind: 'service', controls });
  assert.strictEqual(technical.type, 'technical');
  assert.match(technical.caveat, /lower bound/);
  assert.ok(technical.summary);
  // An organizational failure does not propagate through the service topology.
  const org = ir.dependencyImpact({ capability: 'anonymous-reporting', kind: 'person', controls });
  assert.strictEqual(org.type, 'organizational');
  assert.deepStrictEqual(org.impactedServices, []);
  // Detection moves in both directions.
  assert.strictEqual(technical.detected, true);
  assert.strictEqual(ir.dependencyImpact({ capability: 'anonymous-reporting', kind: 'service', controls: [] }).detected, false);
  assert.throws(() => ir.dependencyImpact({ capability: 'anonymous-reporting', kind: 'astrology', controls }), /unknown dependency kind/);
});

// --- Part 9: multi-perspective risk -----------------------------------------------------------------

test('seven perspectives, and only the constitutional one is a band', () => {
  assert.strictEqual(Object.keys(ir.RISK_PERSPECTIVES).length, 7);
  for (const required of ['constitutional', 'operational', 'mission', 'citizenImpact', 'likelihood', 'recoveryDifficulty', 'urgency']) {
    assert.ok(ir.RISK_PERSPECTIVES[required], required);
  }
  for (const [id, p] of Object.entries(ir.RISK_PERSPECTIVES)) {
    assert.ok(p.asks.endsWith('?'), id);
    assert.ok(p.orderedBy, id);
  }
  const banded = Object.entries(ir.RISK_PERSPECTIVES).filter(([, p]) => p.band).map(([id]) => id);
  assert.deepStrictEqual(banded, ['constitutional']);
});

test('the seven perspectives genuinely produce different orderings', () => {
  const controls = controlsAll();
  const mp = ir.multiPerspectiveRisk(ir.evaluate({ controls }), { controls });
  assert.strictEqual(mp.perspectiveCount, 7);
  assert.ok(mp.distinctOrderings >= 3, `only ${mp.distinctOrderings} distinct orderings`);
  assert.strictEqual(mp.contested, true);
  for (const p of mp.perspectives) {
    assert.strictEqual(p.ranking.length, mp.count, p.perspective);
    p.ranking.forEach((r, n) => assert.strictEqual(r.rank, n + 1));
  }
  // Perspectives that coincide on this data are named rather than presented as independent views.
  assert.ok(Array.isArray(mp.coincidingPerspectives));
  assert.strictEqual(mp.authorizes, false);
});

test('constitutional priority is never collapsed into an arithmetic average', () => {
  const controls = controlsAll();
  const mp = ir.multiPerspectiveRisk(ir.evaluate({ controls }), { controls });
  assert.strictEqual(mp.constitutionalPrimacy, true);
  assert.strictEqual(ir.assertConstitutionalPrimacy(mp.perspectives.find((p) => p.perspective === 'constitutional').ranking), true);
  // The guard can fail, so it is not a tautology.
  assert.throws(() => ir.assertConstitutionalPrimacy([
    { capability: 'service-recovery', kind: 'data', constitutional: false },
    { capability: 'anonymous-reporting', kind: 'service', constitutional: true },
  ]), (e) => e.failClosed === true);
  assert.strictEqual(ir.assertConstitutionalPrimacy([{ capability: 'a', kind: 'x', constitutional: false }]), true);
});
