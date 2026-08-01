'use strict';
// Stabilization Parts 3 & 4 — stable integration contracts and the component migration roadmap.
const test = require('node:test');
const assert = require('node:assert');
const { ContractRegistry, CANONICAL_ERRORS, VERSIONING_POLICY } = require('../src/contracts/integration-contracts');
const migration = require('../src/migration/roadmap');
const contextMap = require('../src/architecture/context-map');
const { generate } = require('../scripts/contracts');

test('contracts: the published set is valid and covers every boundary crossing', () => {
  const reg = new ContractRegistry();
  const res = reg.validate();
  assert.deepStrictEqual(res.violations, []);
  assert.ok(res.contracts >= 18);
  assert.deepStrictEqual(reg.coverage().uncovered, []);
});

test('contracts: every contract declares owner, authentication, authorization and canonical errors', () => {
  const reg = new ContractRegistry();
  const known = new Set(contextMap.ids());
  for (const c of reg.list()) {
    assert.ok(known.has(c.owner), `${c.id} owner`);
    assert.ok(c.authentication, `${c.id} authentication`);
    assert.ok(c.authorization, `${c.id} authorization`);
    assert.ok(c.errors.length >= 1, `${c.id} errors`);
    for (const e of c.errors) assert.ok(CANONICAL_ERRORS[e], `${c.id} canonical error ${e}`);
  }
});

test('contracts: the anonymous reporting path stays anonymous by contract', () => {
  const reg = new ContractRegistry();
  assert.strictEqual(reg.current('api.reports.submit').authentication, 'anonymous');
  assert.strictEqual(reg.current('api.reports.status').authentication, 'case-code');
  // Tightening it would be a breaking, security-reviewed change — not a quiet edit.
  const change = reg.compatibility('api.reports.submit', { authentication: 'session' });
  assert.strictEqual(change.breaking, true);
  assert.strictEqual(change.securityReview, true);
});

test('contracts: identity and content fields are refused on any contract surface', () => {
  const reg = new ContractRegistry();
  for (const field of ['email', 'omang', 'content', 'reporter']) {
    assert.throws(() => reg.register(`api.bad.${field}`, {
      kind: 'api', operation: 'POST /x', owner: 'intake', consumers: ['external-consumer'],
      fields: { required: [field] }, authentication: 'anonymous', errors: ['VALIDATION_FAILED'],
    }), /refuses identity\/content fields/, field);
  }
});

test('contracts: compatibility classification is explainable', () => {
  const reg = new ContractRegistry();
  const add = reg.compatibility('api.reports.submit', { fields: { required: ['category'], optional: ['extra', 'locale'] } });
  assert.strictEqual(add.requiredBump, 'minor');
  assert.strictEqual(add.breaking, false);
  const remove = reg.compatibility('api.reports.submit', { fields: { required: [], optional: [] } });
  assert.strictEqual(remove.requiredBump, 'major');
  assert.ok(remove.changes.some((c) => c.change === 'field-removed'));
  const addRequired = reg.compatibility('api.reports.submit', { fields: { required: ['category', 'urgency'], optional: ['extra'] } });
  assert.strictEqual(addRequired.breaking, true);
});

test('contracts: a breaking revision is refused without a major version and a sunset', () => {
  const reg = new ContractRegistry();
  assert.throws(() => reg.revise('api.case.transition', { fields: { required: ['case_code'], optional: [] } }), /breaking contract change refused/);
  assert.throws(() => reg.revise('api.case.transition', { fields: { required: ['case_code'], optional: [] } }, { major: true }), /requires a recorded sunset/);
  const ok = reg.revise('api.case.transition', { fields: { required: ['case_code'], optional: [] } }, { major: true, sunsetAt: 'Q4-2027' });
  assert.strictEqual(ok.version, 2);
  assert.strictEqual(reg.describe('api.case.transition').sunsetAt, 'Q4-2027');
});

test('contracts: a backward-compatible revision needs no ceremony', () => {
  const reg = new ContractRegistry();
  const res = reg.revise('api.reports.submit', { fields: { required: ['category'], optional: ['extra', 'locale'] } });
  assert.strictEqual(res.breaking, false);
  assert.strictEqual(reg.current('api.reports.submit').version, 2);
  assert.strictEqual(reg.history('api.reports.submit').length, 2);
});

test('contracts: generated artifacts are deterministic and stay in step with the registry', () => {
  const a = generate(); const b = generate();
  assert.strictEqual(a.digest, b.digest, 'contract snapshot must be reproducible');
  assert.strictEqual(a.artifacts.validation.valid, true);
  const apiCount = new ContractRegistry().list({ kind: 'api' }).length;
  const routes = new Set(Object.keys(a.artifacts.openapi.paths));
  assert.ok(routes.size >= 1 && apiCount >= routes.size);
  for (const e of a.artifacts.events) { assert.strictEqual(e.piiFree, true); assert.strictEqual(e.ordered, true); }
  assert.ok(VERSIONING_POLICY.breakingChangeProcess.includes('Dual-run'));
});

test('migration roadmap: valid, covers every named subsystem, and is reversible', () => {
  assert.deepStrictEqual(migration.validate().violations, []);
  const covered = migration.items().map((i) => i.subsystem);
  for (const required of ['Identity', 'Cryptography', 'Storage', 'Messaging', 'Audit', 'Policy Engine', 'Governance Portal', 'Data Exchange', 'Process Mining', 'Performance Observatory']) {
    assert.ok(covered.some((s) => s.startsWith(required)), `missing ${required}`);
  }
  for (const item of migration.items()) {
    assert.ok(item.current.length > 20, `${item.id} current`);
    assert.ok(item.target.length > 20, `${item.id} target`);
    assert.ok(item.strategy.length > 20, `${item.id} strategy`);
    assert.ok(item.rollback.length > 20, `${item.id} rollback`);
    assert.ok(item.risks.length >= 1, `${item.id} risks`);
    assert.ok(item.validations.length >= 1, `${item.id} validations`);
  }
});

test('migration roadmap: incremental order — dependencies are sequenced first', () => {
  const { order, unresolved } = migration.sequence();
  assert.deepStrictEqual(unresolved, []);
  for (const item of migration.items()) {
    for (const dep of item.dependsOn) assert.ok(order.indexOf(dep) < order.indexOf(item.id), `${item.id} before ${dep}`);
  }
  // The security spine goes first.
  assert.strictEqual(migration.describe('identity').wave, 1);
  assert.strictEqual(migration.describe('cryptography').wave, 1);
  assert.ok(migration.describe('processmining').wave >= 4);
});

test('migration readiness is advisory, human-gated, and never authorizes', () => {
  const allPass = [...new Set(migration.items().flatMap((i) => i.validations))].map((id) => ({ id, pass: true }));
  const r = migration.readiness('identity', { fitnessResults: allPass });
  assert.strictEqual(r.humanGate, true);
  assert.strictEqual(r.authorizes, false);
  assert.match(r.note, /recorded decision/i);
  // A failing validation blocks readiness.
  const failing = allPass.map((x) => (x.id === 'APP-FIT-AUTHZ-DEFAULT-DENY' ? { ...x, pass: false } : x));
  assert.strictEqual(migration.readiness('identity', { fitnessResults: failing }).ready, false);
  // An outstanding dependency blocks readiness too (incremental discipline).
  assert.ok(migration.readiness('storage', { fitnessResults: allPass }).dependenciesOutstanding.includes('cryptography'));
});

test('migration roadmap: every item belongs to a real bounded context', () => {
  const known = new Set(contextMap.ids());
  for (const item of migration.items()) assert.ok(known.has(item.context), `${item.id} → ${item.context}`);
  assert.strictEqual(migration.progress().total, migration.items().length);
});
