'use strict';
// Phase 14, Parts 4, 5 & 10 — compliance transition governance, diagram assurance and the seven
// governance states.
const test = require('node:test');
const assert = require('node:assert');
const ci = require('../src/legislation/compliance-intelligence');
const da = require('../src/architecture/documentation-assurance');
const inst = require('../src/assurance/institutional');

const DAY = 24 * 3600_000;
const NOW = 100 * DAY;

// --- Part 4: transition governance -----------------------------------------------------------------

test('an illegal transition is refused fail-closed, and the attempt is recorded', () => {
  const c = new ci.ComplianceIntelligence({ clock: () => NOW });
  assert.throws(() => c.transition('OB-1', { to: 'verified', by: 'Auditor', rationale: 'signed', independent: true }), (e) => e.failClosed === true);
  assert.strictEqual(c.state('OB-1').state, 'unknown');
  // The refusal is kept. An attempt somebody made and the machine turned down is the signal.
  assert.strictEqual(c.refusals().length, 1);
  assert.deepStrictEqual(
    { from: c.refusals()[0].from, to: c.refusals()[0].to, legality: c.refusals()[0].legality },
    { from: 'unknown', to: 'verified', legality: 'refused' },
  );
});

test('the legal path to verified works, so the machine is not simply refusing everything', () => {
  const c = new ci.ComplianceIntelligence({ clock: () => NOW });
  c.transition('OB-1', { to: 'under-assessment', by: 'Legal Informatics Team', rationale: 'opened' });
  c.transition('OB-1', { to: 'compliant', by: 'Legal Informatics Team', rationale: 'controls hold' });
  c.transition('OB-1', { to: 'verified', by: 'Attorney General Chambers', rationale: 'confirmed', independent: true });
  assert.strictEqual(c.state('OB-1').state, 'verified');
  assert.strictEqual(c.refusals().length, 0);
  assert.ok(c.transitionAudit({ now: NOW }).entries.every((e) => e.legality === 'by-default'));
});

test('an exception must name a board, one obligation, one move, and an expiry', () => {
  const ex = new ci.TransitionExceptions({ clock: () => NOW });
  assert.throws(() => ex.grant({ from: 'unknown', to: 'compliant', by: 'OB', rationale: 'r', expiresAt: NOW + DAY }), /must name the obligation/);
  assert.throws(() => ex.grant({ obligation: 'O', from: 'unknown', to: 'compliant', rationale: 'r', expiresAt: NOW + DAY }), (e) => e.failClosed === true);
  assert.throws(() => ex.grant({ obligation: 'O', from: 'unknown', to: 'compliant', by: 'OB', rationale: 'r' }), /must expire/);
  assert.throws(() => ex.grant({ obligation: 'O', from: 'unknown', to: 'nirvana', by: 'OB', rationale: 'r', expiresAt: NOW + DAY }), /two known compliance states/);
  assert.throws(
    () => ex.grant({ obligation: 'O', from: 'unknown', to: 'compliant', by: 'Platform Engineering', rationale: 'in a hurry', expiresAt: NOW + DAY }),
    /not a recognised governance board/,
  );
  // A real board may.
  assert.ok(ex.grant({ obligation: 'O', from: 'unknown', to: 'compliant', by: 'Oversight Board', rationale: 'inherited assessment', expiresAt: NOW + DAY }));
});

test('no exception can ever reach `verified`', () => {
  const ex = new ci.TransitionExceptions({ clock: () => NOW });
  assert.throws(
    () => ex.grant({ obligation: 'O', from: 'unknown', to: 'verified', by: 'Oversight Board', rationale: 'the auditor is confident', expiresAt: NOW + DAY }),
    (e) => e.failClosed === true && /extra steps/.test(e.message),
  );
});

test('a granted exception permits exactly its own move and nothing else', () => {
  const ex = new ci.TransitionExceptions({ clock: () => NOW });
  ex.grant({ obligation: 'OB-2', from: 'unknown', to: 'compliant', by: 'Oversight Board', rationale: 'evidenced out of band', expiresAt: NOW + 30 * DAY });
  const c = new ci.ComplianceIntelligence({ clock: () => NOW, exceptions: ex });
  c.transition('OB-2', { to: 'compliant', by: 'Attorney General Chambers', rationale: 'carried forward' });
  assert.strictEqual(c.state('OB-2').state, 'compliant');
  // Another obligation gets nothing.
  assert.throws(() => c.transition('OB-3', { to: 'compliant', by: 'X', rationale: 'the same shortcut' }), (e) => e.failClosed === true);
  // Another move for the same obligation gets nothing either.
  const other = new ci.ComplianceIntelligence({ clock: () => NOW, exceptions: ex });
  assert.throws(() => other.transition('OB-2', { to: 'remediating', by: 'X', rationale: 'r' }), (e) => e.failClosed === true);
});

test('the audit trail records that a state was reached by exception, and keeps saying so', () => {
  const ex = new ci.TransitionExceptions({ clock: () => NOW });
  ex.grant({ obligation: 'OB-2', from: 'unknown', to: 'compliant', by: 'Oversight Board', rationale: 'evidenced out of band', expiresAt: NOW + 30 * DAY });
  const c = new ci.ComplianceIntelligence({ clock: () => NOW, exceptions: ex });
  c.transition('OB-2', { to: 'compliant', by: 'Attorney General Chambers', rationale: 'carried forward' });

  const audit = c.transitionAudit({ now: NOW });
  assert.strictEqual(audit.byExceptionCount, 1);
  assert.strictEqual(audit.entries[0].legality, 'by-exception');
  assert.strictEqual(audit.entries[0].exception.by, 'Oversight Board');
  assert.strictEqual(audit.exceptionRate, 1);
  assert.strictEqual(audit.machineDescribesPractice, false);

  // Long after the exception lapsed, the record still says how that state was reached.
  const afterwards = c.transitionAudit({ now: NOW + 365 * DAY });
  assert.strictEqual(afterwards.byExceptionCount, 1);
  assert.strictEqual(afterwards.exceptions.expired.length, 1);
  assert.strictEqual(afterwards.exceptions.active.length, 0);
  assert.strictEqual(afterwards.authorizes, false);
});

test('an expired exception stops permitting anything, with nobody withdrawing it', () => {
  const ex = new ci.TransitionExceptions({ clock: () => NOW });
  ex.grant({ obligation: 'OB-4', from: 'unknown', to: 'compliant', by: 'Oversight Board', rationale: 'r', expiresAt: NOW + DAY });
  const later = new ci.ComplianceIntelligence({ clock: () => NOW + 30 * DAY, exceptions: ex });
  assert.throws(() => later.transition('OB-4', { to: 'compliant', by: 'X', rationale: 'r' }), (e) => e.failClosed === true);
});

// --- Part 5: diagram assurance ----------------------------------------------------------------------

test('seven diagram kinds are declared, each saying what resolved means and what a wrong one costs', () => {
  for (const required of ['architecture', 'sequence', 'deployment', 'infrastructure', 'process-flow', 'openapi', 'state']) {
    assert.ok(da.DIAGRAM_KINDS[required], required);
  }
  for (const [id, k] of Object.entries(da.DIAGRAM_KINDS)) {
    assert.ok(k.resolvedMeans, id);
    assert.ok(k.ifWrong, id);
  }
});

test('the governed corpus carries diagrams, and every one of them resolves', () => {
  const r = da.verifyDiagrams({});
  assert.deepStrictEqual(r.findings, []);
  assert.ok(r.count >= da.MINIMUM_DIAGRAMS, `${r.count} diagrams found`);
  assert.strictEqual(r.extractorSound, true);
  assert.strictEqual(r.sound, true);
  // Every resolver is exercised by something real, or its rules have never run.
  for (const kind of ['architecture', 'deployment', 'infrastructure', 'process-flow', 'sequence', 'state']) {
    assert.ok(r.byKind.some((k) => k.kind === kind), `no ${kind} diagram in the corpus`);
  }
});

test('a diagram that draws an arrow the architecture does not declare is a finding', () => {
  const world = da.diagramWorld();
  const bad = da.verifyDiagram({ document: 'x', kind: 'architecture', body: 'graph LR\n  custody[a]\n  intake[b]\n  custody --> intake\n' }, world);
  assert.strictEqual(bad.sound, false);
  assert.match(bad.findings[0].detail, /declares no such dependency/);
  const good = da.verifyDiagram({ document: 'x', kind: 'architecture', body: 'graph LR\n  investigation[a]\n  custody[b]\n  investigation --> custody\n' }, world);
  assert.strictEqual(good.sound, true);
});

test('every resolver rejects a diagram that names something which does not exist', () => {
  const world = da.diagramWorld();
  const cases = [
    ['architecture', 'graph LR\n  ministry-of-magic[a]\n'],
    ['infrastructure', 'graph LR\n  quantum-widget[a]\n'],
    ['deployment', 'graph TD\n  atlantis[a]\n'],
    ['process-flow', 'graph LR\n  world-peace[a]\n'],
    ['state', 'stateDiagram-v2\n  closed --> received\n'],
    ['sequence', 'sequenceDiagram\n  participant nobody-at-all\n  participant intake-api\n  nobody-at-all->>intake-api: hi\n'],
  ];
  for (const [kind, body] of cases) {
    assert.strictEqual(da.verifyDiagram({ document: 'x', kind, body }, world).sound, false, kind);
  }
});

test('a diagram declaring no kind, or containing an unparseable line, is a finding rather than a skip', () => {
  const world = da.diagramWorld();
  const unclassified = da.verifyDiagram({ document: 'x', kind: null, body: 'graph LR\n  a --> b\n' }, world);
  assert.strictEqual(unclassified.sound, false);
  assert.match(unclassified.findings[0].detail, /nothing can classify/);
  const garbled = da.verifyDiagram({ document: 'x', kind: 'architecture', body: 'graph LR\n  intake\n  ??? not mermaid ???\n' }, world);
  assert.strictEqual(garbled.sound, false);
  assert.ok(garbled.findings.some((f) => /unparseable/.test(f.detail)));
});

test('the extractor pulls the declared kind and source out of a fenced block', () => {
  const found = da.extractDiagrams('text\n```mermaid\n%% njtip:kind=architecture source=src/x.js\ngraph LR\n  a --> b\n```\n', { document: 'd' });
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].kind, 'architecture');
  assert.strictEqual(found[0].source, 'src/x.js');
  assert.strictEqual(da.extractDiagrams('no diagrams here').length, 0);
});

test('everything the OpenAPI document publishes is actually served', () => {
  const api = da.verifyOpenApi();
  assert.deepStrictEqual(api.findings, []);
  assert.ok(api.paths >= 10);
  assert.strictEqual(api.sound, true);
});

// --- Part 10: governance state intelligence ---------------------------------------------------------

test('seven governance states, and only two of them count as assured', () => {
  assert.strictEqual(Object.keys(inst.GOVERNANCE_STATES).length, 7);
  for (const required of ['unknown', 'missing', 'not-applicable', 'accepted-risk', 'verified', 'failed', 'pending-review']) {
    assert.ok(inst.GOVERNANCE_STATES[required], required);
  }
  const assured = Object.entries(inst.GOVERNANCE_STATES).filter(([, s]) => s.countsAsAssured).map(([id]) => id).sort();
  assert.deepStrictEqual(assured, ['accepted-risk', 'verified']);
  assert.strictEqual(inst.GOVERNANCE_STATES.unknown.countsAsAssured, false);
  // Assured is not safe. The distinction has to be written down or it will be forgotten.
  assert.match(inst.GOVERNANCE_STATES['accepted-risk'].caveat, /not as safe/);
});

test('not-applicable cannot be asserted without a named person and a reason', () => {
  assert.throws(() => inst.governanceState({ state: 'not-applicable', by: 'X' }), (e) => e.failClosed === true);
  assert.throws(() => inst.governanceState({ state: 'not-applicable', justification: 'out of scope' }), (e) => e.failClosed === true);
  assert.strictEqual(inst.governanceState({ state: 'not-applicable', by: 'DGB', justification: 'no payment data' }).state, 'not-applicable');
});

test('an accepted risk needs an authority, a rationale and an expiry — and lapses back to failed', () => {
  assert.throws(() => inst.governanceState({ state: 'accepted-risk', justification: 'r', expiresAt: 10 * DAY }), (e) => e.failClosed === true);
  assert.throws(() => inst.governanceState({ state: 'accepted-risk', by: 'OB', justification: 'r' }), /requires an expiry/);
  const live = inst.governanceState({ state: 'accepted-risk', by: 'OB', justification: 'planned', expiresAt: 10 * DAY, now: 0 });
  assert.strictEqual(live.state, 'accepted-risk');
  const lapsed = inst.governanceState({ state: 'accepted-risk', by: 'OB', justification: 'planned', expiresAt: 10 * DAY, now: 100 * DAY });
  assert.strictEqual(lapsed.state, 'failed');
  assert.strictEqual(lapsed.lapsedFrom, 'accepted-risk');
});

test('completeness counts every state separately and says what it excluded', () => {
  const c = inst.governanceCompleteness([
    { item: 'a', state: 'verified' },
    { item: 'b', state: 'accepted-risk', by: 'OB', justification: 'planned', expiresAt: 100 * DAY },
    { item: 'c', state: 'failed' },
    { item: 'd', state: 'missing' },
    { item: 'e', state: 'pending-review' },
    { item: 'f', state: 'not-applicable', by: 'DGB', justification: 'no payment data' },
    { item: 'g', state: 'unknown' },
  ], { now: 0 });
  assert.deepStrictEqual(c.byState, {
    verified: 1, 'accepted-risk': 1, failed: 1, missing: 1, 'pending-review': 1, 'not-applicable': 1, unknown: 1,
  });
  assert.strictEqual(c.applicable, 6);
  assert.strictEqual(c.completeness, 0.3333);
  assert.match(c.completenessBasis, /1 verified and 1 accepted as risk/);
  assert.match(c.completenessBasis, /1 item\(s\) were excluded as not applicable/);
  assert.deepStrictEqual(c.unexamined, ['g']);
  assert.strictEqual(c.sound, false);
  // Every actionable item says who has to do what.
  for (const a of c.actionable) assert.ok(a.action, a.item);
});

test('a fully assured estate reaches completeness 1 and still authorizes nothing', () => {
  const c = inst.governanceCompleteness([
    { item: 'a', state: 'verified' },
    { item: 'b', state: 'not-applicable', by: 'DGB', justification: 'no payment data' },
    { item: 'c', state: 'accepted-risk', by: 'OB', justification: 'accepted', expiresAt: 100 * DAY },
  ], { now: 0 });
  assert.strictEqual(c.completeness, 1);
  assert.strictEqual(c.sound, true);
  assert.strictEqual(c.authorizes, false);
});

test('completeness over an empty set says so rather than reporting 100%', () => {
  const c = inst.governanceCompleteness([], { now: 0 });
  assert.strictEqual(c.completeness, null);
  assert.match(c.completenessBasis, /100% of nothing/);
});
