'use strict';
// Phase 12, Parts 11, 12, 13 & 14 — the ADR review lifecycle, pre-deployment release impact,
// active governance ownership, and evidence provenance.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const adr = require('../src/architecture/adr-governance');
const { ConsumerContracts } = require('../src/contracts/consumer-contracts');
const { ContractRegistry } = require('../src/contracts/integration-contracts');
const own = require('../src/governance/ownership');
const ec = require('../src/assurance/evidence-confidence');

const DAY = 24 * 3600_000;
const ADR7 = fs.readFileSync(path.join(adr.ADR_DIR, '0007-session-consistency-and-adr-review-lifecycle.md'), 'utf8');

// --- Part 11: advanced ADR governance -------------------------------------------------------------

test('the governance schema applies from ADR-0007 and layers onto the earlier tiers', () => {
  assert.strictEqual(adr.schemaNameFor(6), 'extended');
  assert.strictEqual(adr.schemaNameFor(7), 'governance');
  assert.strictEqual(
    adr.schemaFor(7).length,
    adr.LEGACY_SCHEMA.length + adr.FULL_SCHEMA.length + adr.EXTENDED_SCHEMA.length + adr.GOVERNANCE_SCHEMA.length,
  );
  assert.deepStrictEqual(adr.GOVERNANCE_SCHEMA.map((s) => s.heading), ['Review schedule', 'Sunset criteria']);
  for (const s of adr.GOVERNANCE_SCHEMA) assert.ok(s.why);
});

test('earlier ADRs are not retrofitted to the governance schema', () => {
  const cat = adr.validateCatalogue();
  assert.strictEqual(cat.valid, true, cat.violations.join('; '));
  assert.strictEqual(cat.bySchema.legacy, 3);
  assert.ok(cat.adrs.filter((a) => a.schema === 'governance').length >= 1);
  for (const a of cat.adrs.filter((x) => x.number < 7)) assert.notStrictEqual(a.schema, 'governance');
});

test('"reviewed periodically" is not a review schedule', () => {
  const vague = ADR7.replace(
    /## Review schedule\n[\s\S]*?\n## Sunset criteria/,
    '## Review schedule\nThis decision is reviewed periodically by the Architecture Review Board, whenever that seems appropriate.\n\n## Sunset criteria',
  );
  const verdict = adr.admit(vague);
  assert.strictEqual(verdict.admitted, false);
  assert.ok(verdict.rejections.some((r) => /is not a schedule/.test(r)));
  // A named interval is enough — the rule asks for a commitment, not for one particular format.
  const interval = ADR7.replace(
    /## Review schedule\n[\s\S]*?\n## Sunset criteria/,
    '## Review schedule\nReviewed by the Architecture Review Board every 6 months, and out of cycle on any sunset trigger.\n\n## Sunset criteria',
  );
  assert.strictEqual(adr.admit(interval).admitted, true);
});

test('an incomplete ADR is rejected outright, never accepted pending sections', () => {
  const noSunset = ADR7.replace(/## Sunset criteria\n[\s\S]*?(?=\n## Decision owner)/, '');
  const verdict = adr.admit(noSunset);
  assert.strictEqual(verdict.admitted, false);
  assert.strictEqual(verdict.rejected, true);
  assert.strictEqual(verdict.failClosed, true);
  assert.ok(verdict.rejections.some((r) => /Sunset criteria/.test(r)));
  assert.match(verdict.note, /REJECTED/);
  assert.match(verdict.note, /accepted-pending-sections/);
});

test('admission is a completeness check and says so — it is not approval', () => {
  const verdict = adr.admit(ADR7);
  assert.strictEqual(verdict.admitted, true);
  assert.strictEqual(verdict.authorizes, false);
  assert.match(verdict.note, /not approval/);
  assert.strictEqual(verdict.schema, 'governance');
  assert.deepStrictEqual(verdict.rejections, []);
});

test('an empty or unnumbered proposal fails closed rather than defaulting to a schema', () => {
  for (const bad of ['', '   ', '## Context\nsomething that is long enough to clear the threshold.']) {
    const verdict = adr.admit(bad);
    assert.strictEqual(verdict.admitted, false, JSON.stringify(bad));
    assert.strictEqual(verdict.failClosed, true);
  }
});

test('quality scores aggregate to the weakest dimension, not the mean', () => {
  const q = adr.qualityReport({ now: '2026-08-03' });
  assert.strictEqual(q.sound, true, JSON.stringify(q.incomplete) + JSON.stringify(q.review.overdue));
  assert.strictEqual(q.authorizes, false);
  for (const d of q.byDimension.filter((x) => x.score !== null)) {
    const rows = q.adrs.map((a) => a.dimensions.find((x) => x.dimension === d.dimension)).filter((x) => x && x.applicable);
    assert.strictEqual(d.score, Math.min(...rows.map((r) => r.score)), d.dimension);
  }
  // An ADR is scored per-ADR the same way: its score is its worst applicable dimension.
  for (const a of q.adrs) {
    const applicable = a.dimensions.filter((d) => d.applicable);
    assert.strictEqual(a.score, Math.min(...applicable.map((d) => d.score)));
  }
});

test('a dimension the ADR\'s schema never required is not applicable, not a failure', () => {
  const legacy = adr.qualityScore(adr.parse(adr.adrFiles()[0]));
  const reviewability = legacy.dimensions.find((d) => d.dimension === 'reviewability');
  assert.strictEqual(reviewability.applicable, false);
  assert.strictEqual(reviewability.score, null);
  assert.strictEqual(legacy.complete, true);   // complete against the standard it was written to
});

test('an ADR with no review schedule is unscheduled, and one with no date is undated', () => {
  const review = adr.dueForReview({ now: '2026-08-03' });
  assert.deepStrictEqual(review.unscheduled, [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(review.undated, []);
  assert.deepStrictEqual(review.overdue, []);
  const seven = review.adrs.find((r) => r.adr === 7);
  assert.strictEqual(seven.scheduled, true);
  assert.strictEqual(seven.nextReview, '2027-02-03');
  // Move the clock past the review date: overdue is reported, not inferred away. ADR-0008 joined in
  // Phase 13 with a 2027-02-04 review date, ADR-0009 in Phase 14 with 2027-02-05, and ADR-0010 in
  // Phase 15 with 2027-02-06 — deliberately adjacent, because the three invariants are one question —
  // so all four are overdue at this instant too.
  assert.deepStrictEqual(adr.dueForReview({ now: '2027-06-01' }).overdue, [7, 8, 9, 10]);
});

test('an interval with no anchoring date reports undated rather than not-due', () => {
  const parsed = adr.parseText('# ADR-0042: probe\n\n## Review schedule\nReviewed annually by the board, with no anchor date recorded anywhere.\n', { number: 42 });
  const r = adr.nextReview(parsed);
  assert.strictEqual(r.scheduled, true);
  assert.strictEqual(r.nextReview, null);
  assert.match(r.reason, /cannot become overdue/);
  assert.deepStrictEqual(adr.dueForReview({ now: '2026-08-03', results: [parsed] }).undated, [42]);
});

// --- Part 12: consumer dependency intelligence ----------------------------------------------------

function contracts() {
  const registry = new ContractRegistry();
  return { registry, cc: new ConsumerContracts({ registry }) };
}

test('an unassessed release is not a safe release', () => {
  const { cc } = contracts();
  const r = cc.releaseImpact({ release: 'nothing-submitted' });
  assert.strictEqual(r.deployable, false);
  assert.ok(r.blockers.some((b) => b.check === 'no-changes-assessed'));
  assert.match(r.note, /RELEASE BLOCKED/);
  assert.strictEqual(r.failClosed, true);
  assert.strictEqual(r.authorizes, false);
});

test('an additive release passes, so the gate can pass as well as block', () => {
  const { registry, cc } = contracts();
  const submit = registry.current('api.reports.submit');
  const r = cc.releaseImpact({
    release: 'v1.12.0',
    changes: [{ contract: 'api.reports.submit', description: 'accept an optional locale', spec: { fields: { required: submit.fields.required, optional: [...submit.fields.optional, 'locale'] } } }],
  });
  assert.strictEqual(r.deployable, true);
  assert.strictEqual(r.worstBand, 'none');
  assert.strictEqual(r.constitutionalImpact, false);
  assert.match(r.note, /remains a recorded decision by a named human/);
});

test('a release that breaks the constitutional path is blocked before deployment', () => {
  const { cc } = contracts();
  const r = cc.releaseImpact({ release: 'v2', changes: [{ contract: 'api.reports.submit', spec: { fields: { required: [], optional: [] } } }] });
  assert.strictEqual(r.deployable, false);
  assert.strictEqual(r.constitutionalImpact, true);
  const blocker = r.blockers.find((b) => b.check === 'constitutional-consumer');
  assert.ok(blocker);
  assert.match(blocker.reason, /citizen-web/);
});

test('two separately-acceptable changes landing on one consumer make one unacceptable release', () => {
  const { registry, cc } = contracts();
  const status = registry.current('api.reports.status');
  const r = cc.releaseImpact({
    release: 'v3',
    changes: [
      { contract: 'api.reports.submit', spec: { fields: { required: [], optional: [] } } },
      { contract: 'api.reports.status', spec: { fields: { required: [], optional: [] }, responseFields: status.responseFields } },
    ],
  });
  const web = r.consumers.find((c) => c.consumer === 'citizen-web');
  assert.strictEqual(web.changeCount, 2);
  assert.strictEqual(web.simultaneousBreak, true);
  assert.deepStrictEqual(r.simultaneouslyBroken, ['citizen-web']);
  assert.ok(r.blockers.some((b) => b.check === 'simultaneous-break'));
  // The release band is its worst change, not the average of the two.
  assert.strictEqual(r.worstBand, 'severe');
});

test('a release naming an unknown contract is refused rather than skipped', () => {
  const { cc } = contracts();
  assert.throws(() => cc.releaseImpact({ changes: [{ contract: 'api.does.not.exist', spec: {} }] }), /unknown contract/);
  assert.throws(() => cc.releaseImpact({ changes: [{ spec: {} }] }), /must name the contract/);
  assert.throws(() => cc.releaseImpact({ changes: 'everything' }), /a list of contract changes/);
});

// --- Part 13: governance continuity intelligence --------------------------------------------------

const NOW = 400 * DAY;
function evidencedEstate({ actAt = NOW - 10 * DAY, trainedAt = NOW - 30 * DAY } = {}) {
  const activity = new own.ActivityRegister({ clock: () => NOW });
  const training = new own.TrainingRegister({ clock: () => NOW });
  for (const s of own.subsystems()) {
    for (const role of own.DEPUTY_ROLES) {
      const holder = own.OWNERSHIP[s][role];
      activity.recordAct({ person: holder, act: 'review', subsystem: s, at: actAt });
      for (const course of own.REQUIRED_TRAINING[role]) training.recordCompletion({ person: holder, course, at: trainedAt, by: 'Registrar of Governance' });
    }
  }
  return { activity, training };
}

test('unknown activity is reported as unknown, never as active ownership', () => {
  const blind = own.continuityDashboard({ now: NOW });
  assert.strictEqual(blind.sound, false);
  assert.ok(blind.blockers.some((b) => /unknown is not active/.test(b)));
  assert.strictEqual(blind.dormantOwners, null);
  assert.strictEqual(blind.uncertifiedOwners, null);
  assert.match(blind.answer, /^No\./);
});

test('an available, active and certified estate is soundly owned', () => {
  const { activity, training } = evidencedEstate();
  const d = own.continuityDashboard({ activity, training, now: NOW });
  assert.strictEqual(d.sound, true, d.blockers.slice(0, 3).join('; '));
  assert.strictEqual(d.activeCoverage, 1);
  assert.strictEqual(d.availabilityCoverage, 1);
  assert.strictEqual(d.authorizes, false);
  assert.match(d.question, /available, active and currently certified/);
});

test('a dormant owner is available and not actively owning — the two are separate facts', () => {
  const { training } = evidencedEstate();
  const { activity } = evidencedEstate({ actAt: NOW - 300 * DAY });
  const d = own.continuityDashboard({ activity, training, now: NOW });
  assert.strictEqual(d.sound, false);
  assert.ok(d.dormantOwners.length > 0);
  // Availability itself is unchanged — activity did not redefine it.
  assert.strictEqual(own.coverageScore({ now: NOW }).coverage, 1);
  assert.strictEqual(d.availabilityCoverage, 1);
  assert.ok(d.activeCoverage < 1);
});

test('never having acted is its own state, and the worst one', () => {
  const activity = new own.ActivityRegister({ clock: () => NOW });
  const never = activity.status('Deputy Registrar of Nothing', { now: NOW });
  assert.strictEqual(never.band, 'never-acted');
  assert.strictEqual(never.acceptable, false);
  assert.strictEqual(never.daysSinceAct, null);
  activity.recordAct({ person: 'Registrar', act: 'approval', at: NOW - 100 * DAY });
  assert.strictEqual(activity.status('Registrar', { now: NOW }).band, 'stale');
  activity.recordAct({ person: 'Registrar', act: 'decision', at: NOW - 5 * DAY });
  assert.strictEqual(activity.status('Registrar', { now: NOW }).band, 'active');
  assert.throws(() => activity.recordAct({ person: 'Registrar', act: 'thinking-about-it' }), /unknown governance act/);
  assert.throws(() => activity.recordAct({ act: 'review' }), /must name the person/);
});

test('missing training and expired training are reported separately', () => {
  const training = new own.TrainingRegister({ clock: () => NOW });
  const missing = training.status('Registrar', 'dataSteward', { now: NOW });
  assert.strictEqual(missing.current, false);
  assert.deepStrictEqual(missing.missing, own.REQUIRED_TRAINING.dataSteward);
  assert.deepStrictEqual(missing.expired, []);
  for (const c of own.REQUIRED_TRAINING.dataSteward) training.recordCompletion({ person: 'Registrar', course: c, at: NOW - 400 * DAY, by: 'Permanent Secretary' });
  const lapsed = training.status('Registrar', 'dataSteward', { now: NOW });
  assert.deepStrictEqual(lapsed.missing, []);
  assert.deepStrictEqual(lapsed.expired, own.REQUIRED_TRAINING.dataSteward);
  assert.match(lapsed.reason, /^expired/);
  // Renewal makes it current again, and does not duplicate the record.
  for (const c of own.REQUIRED_TRAINING.dataSteward) training.recordCompletion({ person: 'Registrar', course: c, at: NOW - 10 * DAY, by: 'Permanent Secretary' });
  assert.strictEqual(training.status('Registrar', 'dataSteward', { now: NOW }).current, true);
  assert.strictEqual(training.completions('Registrar').length, own.REQUIRED_TRAINING.dataSteward.length);
});

test('a self-declared certification certifies nothing', () => {
  const training = new own.TrainingRegister({ clock: () => NOW });
  assert.throws(() => training.recordCompletion({ person: 'X', course: 'records-management', at: NOW }), /attested by a named human/);
  assert.throws(() => training.recordCompletion({ person: 'X', by: 'Y', at: NOW }), /a person and a course/);
});

test('an escalation cannot be resolved without ever being acknowledged', () => {
  const esc = new own.EscalationWorkflow({ clock: () => NOW });
  const item = esc.raise({ subsystem: own.subsystems()[0], reason: 'no available owner', raisedBy: 'Duty Officer' });
  assert.strictEqual(item.state, 'raised');
  assert.ok(item.terminatesAt);
  assert.throws(() => esc.resolve(item.id, { by: 'Chair', resolution: 'sorted' }), /must be acknowledged before/);
  assert.throws(() => esc.acknowledge(item.id, {}), /must name the human/);
  esc.acknowledge(item.id, { by: 'Vice-Chair' });
  assert.throws(() => esc.acknowledge(item.id, { by: 'Vice-Chair' }), /cannot be acknowledged again/);
  const resolved = esc.resolve(item.id, { by: 'Chair', resolution: 'deputy confirmed in writing' });
  assert.strictEqual(resolved.state, 'resolved');
  assert.strictEqual(esc.status({ now: NOW }).byState.resolved, 1);
});

test('an escalation raised and never acknowledged becomes visible on its own', () => {
  const esc = new own.EscalationWorkflow({ clock: () => NOW });
  esc.raise({ subsystem: own.subsystems()[0], reason: 'unowned control', raisedBy: 'Duty Officer' });
  assert.strictEqual(esc.status({ now: NOW }).healthy, true);
  const later = esc.status({ now: NOW + 2 * DAY });
  assert.strictEqual(later.healthy, false);
  assert.strictEqual(later.unacknowledged.length, 1);
  assert.ok(later.unacknowledged[0].escalateTo);
  assert.throws(() => esc.raise({ subsystem: 'not-a-subsystem', reason: 'x', raisedBy: 'y' }), /no ownership record/);
  assert.throws(() => esc.raise({ subsystem: own.subsystems()[0], raisedBy: 'y' }), /must state a reason/);
});

test('an unsupplied escalation workflow reports that it cannot see, not that all is well', () => {
  const { activity, training } = evidencedEstate();
  const d = own.continuityDashboard({ activity, training, now: NOW });
  assert.strictEqual(d.escalations.healthy, null);
  assert.match(d.escalations.note, /not the same as there being none/);
});

// --- Part 14: evidence confidence intelligence ----------------------------------------------------

test('a trend needs two verifications — one observation is a value, not a direction', () => {
  let clock = 0;
  const reg = new ec.EvidenceRegister({ clock: () => clock });
  assert.strictEqual(reg.confidenceTrend('nothing').direction, 'insufficient-data');
  reg.record({ id: 'e', source: 'executable-check', completeness: 1, verifiedAt: 0, now: 0 });
  const one = reg.confidenceTrend('e');
  assert.strictEqual(one.direction, 'insufficient-data');
  assert.strictEqual(one.observations, 1);
  assert.match(one.reason, /not a direction/);
});

test('re-recording an identical observation does not manufacture a trend', () => {
  let clock = 0;
  const reg = new ec.EvidenceRegister({ clock: () => clock });
  for (let i = 0; i < 5; i++) reg.record({ id: 'e', source: 'executable-check', completeness: 1, verifiedAt: 0, now: 0 });
  assert.strictEqual(reg.history('e').length, 1);
  assert.strictEqual(reg.confidenceTrend('e').direction, 'insufficient-data');
});

test('falling confidence is reported as degrading, with consecutive falls counted', () => {
  let clock = 0;
  const reg = new ec.EvidenceRegister({ clock: () => clock });
  reg.record({ id: 'e', source: 'executable-check', completeness: 1, verifiedAt: 0, now: 0 });
  clock = 6 * 3600_000; reg.record({ id: 'e', source: 'executable-check', completeness: 0.9, verifiedAt: 0, now: clock });
  clock = 12 * 3600_000; reg.record({ id: 'e', source: 'executable-check', completeness: 0.8, verifiedAt: 0, now: clock });
  const t = reg.confidenceTrend('e');
  assert.strictEqual(t.direction, 'degrading');
  assert.strictEqual(t.observations, 3);
  assert.strictEqual(t.consecutiveFalls, 2);
  assert.strictEqual(t.bandChanged, true);
  assert.match(t.warning, /on its way out/);
});

test('rising confidence is reported as improving, so the trend can pass as well as fail', () => {
  let clock = 0;
  const reg = new ec.EvidenceRegister({ clock: () => clock });
  reg.record({ id: 'e', source: 'derived-computation', completeness: 0.5, verifiedAt: 0, now: 0 });
  clock = 3600_000; reg.record({ id: 'e', source: 'derived-computation', completeness: 0.9, verifiedAt: clock, now: clock });
  const t = reg.confidenceTrend('e');
  assert.strictEqual(t.direction, 'improving');
  assert.strictEqual(t.warning, null);
  assert.ok(t.delta > 0);
});

test('the provenance report traces every input and states what it does not establish', () => {
  let clock = 0;
  const reg = new ec.EvidenceRegister({ clock: () => clock });
  reg.record({ id: 'chain', source: 'recorded-decision', completeness: 1, verifiedAt: 0, now: 0, detail: 'governance ledger' });
  clock = 30 * DAY; reg.record({ id: 'chain', source: 'recorded-decision', completeness: 1, verifiedAt: clock, now: clock });
  const p = reg.provenanceReport('chain');
  assert.strictEqual(p.known, true);
  assert.strictEqual(p.source, 'recorded-decision');
  assert.ok(p.sourceMeaning && p.reVerifiedWhen);
  assert.strictEqual(p.manualEntry, false);
  assert.match(p.derivationNote, /cannot be supplied/);
  assert.strictEqual(p.verifications, 2);
  assert.strictEqual(p.authorizes, false);
  assert.match(p.doesNotEstablish, /never one/);
  // The calculation is reproducible from the report itself.
  assert.match(p.calculation, new RegExp(`= ${p.confidence}$`));
});

test('a provenance report for evidence that does not exist says so', () => {
  const reg = new ec.EvidenceRegister({ clock: () => 0 });
  const p = reg.provenanceReport('never-recorded');
  assert.strictEqual(p.known, false);
  assert.match(p.reason, /absence of a record is not evidence/);
  assert.strictEqual(p.authorizes, false);
});

test('the register-wide provenance report names what is degrading and what is untrended', () => {
  let clock = 0;
  const reg = new ec.EvidenceRegister({ clock: () => clock });
  reg.record({ id: 'falling', source: 'executable-check', completeness: 1, verifiedAt: 0, now: 0 });
  reg.record({ id: 'single', source: 'declared-configuration', completeness: 1, verifiedAt: 0, now: 0 });
  clock = 12 * 3600_000; reg.record({ id: 'falling', source: 'executable-check', completeness: 0.5, verifiedAt: 0, now: clock });
  const p = reg.provenance();
  assert.deepStrictEqual(p.degrading, ['falling']);
  assert.deepStrictEqual(p.untrended, ['single']);
  assert.strictEqual(p.warnings.length, 1);
  assert.strictEqual(p.count, 2);
  assert.strictEqual(p.authorizes, false);
  // Aggregate remains weakest-link, as Phase 11 established.
  assert.strictEqual(p.aggregate.confidence, Math.min(...p.evidence.map((e) => e.confidence)));
});

test('confidence still cannot be hand-entered, and history records only what was assessed', () => {
  const reg = new ec.EvidenceRegister({ clock: () => 0 });
  assert.throws(() => reg.record({ id: 'e', source: 'executable-check', confidence: 0.99 }), (e) => e.failClosed === true);
  assert.strictEqual(reg.history('e').length, 0);
});
