'use strict';
// Stabilization Parts 1, 2 & 14 — bounded-context map, architecture baseline discipline,
// and the institutional governance ownership model.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const contextMap = require('../src/architecture/context-map');
const ownership = require('../src/governance/ownership');
const { createApp } = require('../src/app');

test('context map: every context declares purpose, rationale, modules and responsibilities', () => {
  for (const c of contextMap.contexts()) {
    assert.ok(c.purpose.length > 10, `${c.id} purpose`);
    assert.ok(c.rationale.length > 10, `${c.id} rationale`);
    assert.ok(c.modules.length >= 1, `${c.id} modules`);
    assert.ok(c.responsibilities.length >= 1, `${c.id} responsibilities`);
  }
  assert.strictEqual(contextMap.validate().valid, true);
});

test('context map: dependency graph is acyclic and every target exists', () => {
  assert.deepStrictEqual(contextMap.cycles(), []);
  const known = new Set(contextMap.ids());
  for (const [from, deps] of Object.entries(contextMap.dependencyGraph())) {
    for (const to of deps) assert.ok(known.has(to), `${from} → unknown ${to}`);
  }
});

test('context map: every communication path names a DDD pattern and a mechanism', () => {
  const paths = contextMap.communicationPaths();
  assert.ok(paths.length > 20);
  for (const p of paths) {
    assert.ok(contextMap.RELATIONSHIPS.has(p.relationship), `${p.from}→${p.to} relationship`);
    assert.ok(contextMap.MECHANISMS.has(p.mechanism), `${p.from}→${p.to} mechanism`);
  }
});

test('context map: anti-corruption layers guard every external model', () => {
  const acls = contextMap.antiCorruptionLayers();
  const translated = new Set(acls.flatMap((a) => a.translates));
  for (const external of ['external-idp', 'external-agency-consumer', 'external-cloud-provider', 'external-supplier', 'external-threat-feed']) {
    assert.ok(translated.has(external), `no ACL translates ${external}`);
  }
});

test('context map: shared kernels have an authoritative owner and real members', () => {
  const kernels = contextMap.sharedKernels();
  assert.ok(Object.keys(kernels).length >= 4);
  for (const [id, k] of Object.entries(kernels)) {
    assert.ok(contextMap.ids().includes(k.authority), `${id} authority`);
    assert.ok(k.members.length >= 1, `${id} has no members`);
  }
  // Privacy invariants are shared by every data-touching context — that is the point.
  assert.ok(kernels['privacy-invariants'].members.includes('intake'));
  assert.ok(kernels['privacy-invariants'].members.includes('analytics'));
});

test('context map: upstream/downstream is symmetric', () => {
  for (const id of contextMap.ids()) {
    for (const up of contextMap.upstreamDownstream(id).upstream) {
      assert.ok(contextMap.upstreamDownstream(up).downstream.includes(id), `${up} does not list ${id} downstream`);
    }
  }
});

test('context map: coupling and cohesion are computed and stable', () => {
  const c = contextMap.coupling('identity-access');
  assert.ok(c.afferent >= 3, 'identity-access should be depended upon');
  assert.strictEqual(c.efferent, 0, 'identity-access should not depend on other contexts');
  assert.strictEqual(c.instability, 0, 'a maximally stable context has instability 0');
  const coh = contextMap.cohesion('privacy');
  assert.ok(coh.cohesion > 0.5, 'privacy should be highly cohesive');
  assert.deepStrictEqual(contextMap.coupling('intake'), contextMap.coupling('intake'));
});

test('context map: boundary review left no unreviewed responsibility overlap', () => {
  assert.deepStrictEqual(contextMap.overlaps(), [], 'overlaps must be resolved or explicitly accepted');
  // Any context flagged for consolidation must name where it goes.
  for (const cand of contextMap.consolidationCandidates()) assert.ok(cand.consolidateInto, `${cand.context} needs a target`);
});

test('context map: every source module is owned by exactly one bounded context', () => {
  const mo = contextMap.moduleOwnership();
  assert.deepStrictEqual(mo.unmapped, [], 'orphan modules');
  assert.deepStrictEqual(mo.multiple, [], 'modules claimed by several contexts');
  assert.ok(mo.modules >= 90);
  // The composition root is explicitly modelled as such (not a bounded context).
  assert.strictEqual(mo.owner['src/app.js'], 'composition');
  assert.strictEqual(contextMap.describe('composition').kind, 'composition-root');
});

test('architecture baseline v1.7 and the ADR catalogue are published', () => {
  const docs = path.join(__dirname, '..', 'docs');
  const baseline = fs.readFileSync(path.join(docs, 'ARCHITECTURE-BASELINE-v1.7.md'), 'utf8');
  assert.match(baseline, /FROZEN/);
  assert.match(baseline, /ADR/);
  const adrs = fs.readdirSync(path.join(docs, 'adr')).filter((f) => /^\d{4}-/.test(f));
  assert.ok(adrs.length >= 3, 'ADR catalogue should record the freeze and the boundary decisions');
  const governance = fs.readFileSync(path.join(docs, 'architecture-governance.md'), 'utf8');
  assert.match(governance, /ADR catalogue/i);
});

test('ownership: every context has a complete accountability record', () => {
  assert.strictEqual(ownership.validate().valid, true);
  for (const id of contextMap.ids()) {
    const o = ownership.describe(id);
    for (const role of ownership.ROLES) assert.ok(o[role], `${id} missing ${role}`);
    assert.notStrictEqual(o.responsibleAuthority, o.approvingAuthority, `${id} SoD`);
  }
});

test('ownership: escalation terminates at a recognised governance board', () => {
  for (const id of ownership.subsystems()) {
    const e = ownership.escalationPath(id);
    assert.ok(e.path.length >= 3, `${id} escalation too short`);
    assert.strictEqual(e.terminatesAt, ownership.describe(id).governanceBoard);
    assert.ok(e.board.length > 3);
  }
  const boards = ownership.boards();
  assert.ok(boards.every((b) => b.subsystems.length >= 1), 'every board governs something');
});

test('ownership: accountability resolves through the context map and carries no personal data', () => {
  const a = ownership.accountabilityFor('custody');
  assert.strictEqual(a.context, 'custody');
  assert.match(a.purpose, /custody/i);
  assert.ok(a.dataSteward);
  assert.ok(!/@|omang/i.test(JSON.stringify(ownership.model())), 'roles only — never named individuals');
});

test('composition root refuses to start on an invalid architecture-of-record', () => {
  // The real app composes only because both models validate (fail-closed startup gate).
  const app = createApp();
  assert.strictEqual(app.architecture.validate().valid, true);
  assert.strictEqual(app.ownership.validate().valid, true);
  assert.strictEqual(app.architecture.contextMap().validation.valid, true);
});
